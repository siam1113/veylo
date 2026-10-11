-- Raw idea versions contain immutable pieces, separate from row revision numbers.
ALTER TABLE intentions ADD COLUMN original_versions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE intentions ADD CONSTRAINT intentions_original_versions_array CHECK (jsonb_typeof(original_versions) = 'array');
UPDATE intentions SET original_versions = jsonb_build_array(jsonb_build_object(
  'id', client_id, 'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'pieces', jsonb_build_array(jsonb_build_object('id', client_id, 'content', raw_capture,
    'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'syncedAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))))
WHERE deleted_at IS NULL;

CREATE FUNCTION initialize_original_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_versions = '[]'::jsonb THEN
    NEW.original_versions := jsonb_build_array(jsonb_build_object(
      'id', NEW.client_id, 'createdAt', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'pieces', jsonb_build_array(jsonb_build_object('id', NEW.client_id, 'content', NEW.raw_capture,
        'createdAt', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'syncedAt', to_char(NEW.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION initialize_original_version() FROM PUBLIC;
CREATE TRIGGER intentions_original_version BEFORE INSERT ON intentions FOR EACH ROW EXECUTE FUNCTION initialize_original_version();

ALTER TABLE intention_revisions ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE intention_revisions DROP CONSTRAINT intention_revisions_action_check;
ALTER TABLE intention_revisions ADD CONSTRAINT intention_revisions_action_check CHECK (action IN ('created','updated','status_changed','deleted','ai_suggestion','ai_undo','ai_requested','piece_added','version_started'));
ALTER TABLE intention_revisions DROP CONSTRAINT intention_revisions_owner_intention_version_key;
ALTER TABLE intention_revisions ADD CONSTRAINT intention_revisions_owner_intention_version_action_key UNIQUE (owner_id, intention_id, version, action);

CREATE OR REPLACE FUNCTION record_intention_revision() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed text[];
  revision_action varchar(24);
  event_details jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := ARRAY['rawCapture','title','kind','intent','purpose','desiredOutcome','roughPlan','horizon','effortEstimate','energyContext','status'];
    revision_action := 'created';
  ELSE
    IF NEW.version <= OLD.version THEN RETURN NEW; END IF;
    changed := array_remove(ARRAY[
      CASE WHEN NEW.original_versions IS DISTINCT FROM OLD.original_versions THEN 'originalPieces' END,
      CASE WHEN NEW.raw_capture IS DISTINCT FROM OLD.raw_capture THEN 'rawCapture' END,
      CASE WHEN NEW.title IS DISTINCT FROM OLD.title THEN 'title' END,
      CASE WHEN NEW.kind IS DISTINCT FROM OLD.kind THEN 'kind' END,
      CASE WHEN NEW.intent IS DISTINCT FROM OLD.intent THEN 'intent' END,
      CASE WHEN NEW.purpose IS DISTINCT FROM OLD.purpose THEN 'purpose' END,
      CASE WHEN NEW.desired_outcome IS DISTINCT FROM OLD.desired_outcome THEN 'desiredOutcome' END,
      CASE WHEN NEW.rough_plan IS DISTINCT FROM OLD.rough_plan THEN 'roughPlan' END,
      CASE WHEN NEW.horizon IS DISTINCT FROM OLD.horizon THEN 'horizon' END,
      CASE WHEN NEW.effort_estimate IS DISTINCT FROM OLD.effort_estimate THEN 'effortEstimate' END,
      CASE WHEN NEW.energy_context IS DISTINCT FROM OLD.energy_context THEN 'energyContext' END,
      CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'status' END,
      CASE WHEN NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN 'deleted' END
    ]::text[], NULL);
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      revision_action := 'deleted';
    ELSIF NEW.ai_metadata->>'undoneAt' IS DISTINCT FROM OLD.ai_metadata->>'undoneAt' AND NEW.ai_metadata->>'undoneAt' IS NOT NULL THEN
      revision_action := 'ai_undo';
    ELSIF NEW.original_versions IS DISTINCT FROM OLD.original_versions THEN
      revision_action := CASE WHEN jsonb_array_length(NEW.original_versions) > jsonb_array_length(OLD.original_versions) THEN 'version_started' ELSE 'piece_added' END;
    ELSIF NEW.ai_metadata #>> '{fieldEvaluation,evaluatedAt}' IS DISTINCT FROM OLD.ai_metadata #>> '{fieldEvaluation,evaluatedAt}' AND NEW.ai_metadata #>> '{fieldEvaluation,evaluatedAt}' IS NOT NULL THEN
      revision_action := 'ai_suggestion';
    ELSIF NEW.ai_metadata->>'processedAt' IS DISTINCT FROM OLD.ai_metadata->>'processedAt' AND NEW.ai_metadata->>'processedAt' IS NOT NULL THEN
      revision_action := 'ai_suggestion';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      revision_action := 'status_changed';
    ELSE
      revision_action := 'updated';
    END IF;
  END IF;

  IF revision_action = 'ai_suggestion' THEN
    event_details := jsonb_build_object('questions', COALESCE((SELECT jsonb_agg(field->>'label') FROM jsonb_array_elements(COALESCE(NEW.ai_metadata #> '{fieldEvaluation,fields}', '[]'::jsonb)) field), '[]'::jsonb));
  END IF;

  INSERT INTO public.intention_revisions(owner_id, intention_id, version, action, changed_fields, details)
    VALUES (NEW.owner_id, NEW.id, NEW.version, revision_action, changed, event_details);
  RETURN NEW;
END;
$$;

