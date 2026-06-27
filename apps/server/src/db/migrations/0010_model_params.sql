-- Per-model parameters (thinking / reasoning effort, max mode), set via the
-- model catalog discovery + the /effort command. Stored as a JSON array of
-- { id, value } pairs mirroring the Cursor SDK's ModelSelection.params. NULL =
-- the model's defaults. The CHECK guards against malformed JSON at write time;
-- the allowed parameter values themselves are discovered at runtime via
-- Cursor.models.list() and are not constrained here.
ALTER TABLE agents
  ADD COLUMN model_params_json TEXT
  CHECK (model_params_json IS NULL OR json_valid(model_params_json));
