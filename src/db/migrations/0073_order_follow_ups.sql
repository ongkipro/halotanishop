-- Explicit operator evidence, not WhatsApp clicks or delivery receipts.
CREATE TABLE order_follow_ups (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN ('welcome','1','2','3','4','5','6','7','8','9')),
  completed INTEGER NOT NULL CHECK (completed IN (0,1)),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (order_id, step)
);
