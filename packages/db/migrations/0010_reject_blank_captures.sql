ALTER TABLE intentions
  ADD CONSTRAINT intentions_raw_capture_nonblank_check
  CHECK (raw_capture !~ '^[[:space:]]*$');
