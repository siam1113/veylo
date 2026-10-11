ALTER TABLE intentions
  DROP CONSTRAINT intentions_raw_capture_check,
  ADD CONSTRAINT intentions_raw_capture_check
    CHECK (char_length(raw_capture) BETWEEN 1 AND 8000);
