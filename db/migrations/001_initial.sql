BEGIN;

CREATE TYPE run_status AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE task_status AS ENUM ('pending', 'running', 'succeeded', 'failed', 'blocked');

CREATE TABLE orchestration_runs (
  id uuid PRIMARY KEY,
  goal text NOT NULL,
  status run_status NOT NULL DEFAULT 'running',
  max_budget_usd numeric(12, 6) NOT NULL CHECK (max_budget_usd > 0),
  spent_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE orchestration_tasks (
  run_id uuid NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
  id text NOT NULL,
  role text NOT NULL,
  capability text NOT NULL,
  prompt text NOT NULL,
  dependencies text[] NOT NULL DEFAULT '{}',
  status task_status NOT NULL DEFAULT 'pending',
  provider text,
  model text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  output text,
  error text,
  route_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  PRIMARY KEY (run_id, id)
);

CREATE INDEX orchestration_tasks_runnable_idx ON orchestration_tasks (run_id, status);

COMMIT;
