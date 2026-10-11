-- Keep a private audit timeline without duplicating captures or edited values.
CREATE TABLE intention_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intention_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action varchar(24) NOT NULL CHECK (action IN ('created','updated','status_changed','deleted','ai_suggestion','ai_undo')),
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intention_revisions_intention_owner_fkey
    FOREIGN KEY (owner_id, intention_id) REFERENCES intentions(owner_id, id) ON DELETE CASCADE,
  CONSTRAINT intention_revisions_owner_intention_version_key UNIQUE (owner_id, intention_id, version)
);
CREATE INDEX intention_revisions_recent_idx ON intention_revisions(owner_id, intention_id, created_at DESC);
ALTER TABLE intention_revisions ENABLE ROW LEVEL SECURITY;

-- Existing records begin with a truthful current-state baseline; earlier
-- field values were not retained by the previous schema.
INSERT INTO intention_revisions(owner_id, intention_id, version, action, changed_fields, created_at)
SELECT owner_id, id, version, 'updated',
  ARRAY['rawCapture','title','kind','intent','purpose','desiredOutcome','roughPlan','horizon','effortEstimate','energyContext','status'],
  updated_at
FROM intentions
WHERE deleted_at IS NULL
ON CONFLICT (owner_id, intention_id, version) DO NOTHING;

CREATE FUNCTION record_intention_revision() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed text[];
  revision_action varchar(24);
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := ARRAY['rawCapture','title','kind','intent','purpose','desiredOutcome','roughPlan','horizon','effortEstimate','energyContext','status'];
    revision_action := 'created';
  ELSE
    IF NEW.version <= OLD.version THEN RETURN NEW; END IF;
    changed := array_remove(ARRAY[
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
    ELSIF NEW.ai_metadata->>'processedAt' IS DISTINCT FROM OLD.ai_metadata->>'processedAt' AND NEW.ai_metadata->>'processedAt' IS NOT NULL THEN
      revision_action := 'ai_suggestion';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      revision_action := 'status_changed';
    ELSE
      revision_action := 'updated';
    END IF;
  END IF;

  INSERT INTO public.intention_revisions(owner_id, intention_id, version, action, changed_fields)
    VALUES (NEW.owner_id, NEW.id, NEW.version, revision_action, changed);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION record_intention_revision() FROM PUBLIC;
CREATE TRIGGER intentions_revision_history
  AFTER INSERT OR UPDATE ON intentions
  FOR EACH ROW EXECUTE FUNCTION record_intention_revision();
