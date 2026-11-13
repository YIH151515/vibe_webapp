CREATE TABLE dbo.rate_buckets (
  action VARCHAR(20) NOT NULL,
  client_key CHAR(64) NOT NULL,
  generation UNIQUEIDENTIFIER NOT NULL,
  used_count INT NOT NULL CONSTRAINT DF_rate_buckets_used DEFAULT 0,
  pending_count INT NOT NULL CONSTRAINT DF_rate_buckets_pending DEFAULT 0,
  window_started_at DATETIME2(3) NOT NULL,
  expires_at DATETIME2(3) NOT NULL,
  CONSTRAINT PK_rate_buckets PRIMARY KEY (action, client_key),
  CONSTRAINT CK_rate_buckets_used CHECK (used_count >= 0),
  CONSTRAINT CK_rate_buckets_pending CHECK (pending_count >= 0),
  CONSTRAINT CK_rate_buckets_action CHECK (action IN ('post-create', 'post-password', 'admin-login')),
  CONSTRAINT CK_rate_buckets_window CHECK (expires_at > window_started_at)
);
CREATE INDEX IX_rate_buckets_expires_at ON dbo.rate_buckets(expires_at);
