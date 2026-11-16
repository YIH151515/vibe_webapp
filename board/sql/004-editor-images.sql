ALTER TABLE dbo.posts ADD
  content_format VARCHAR(8) NOT NULL CONSTRAINT DF_posts_content_format DEFAULT 'plain',
  content_json NVARCHAR(MAX) NULL;
ALTER TABLE dbo.posts DROP CONSTRAINT CK_posts_content;
-- Compile this constraint only after the preceding ALTER has created its columns.
EXEC(N'ALTER TABLE dbo.posts ADD CONSTRAINT CK_posts_content_format CHECK (
  (content_format = ''plain'' AND content_json IS NULL AND DATALENGTH(content) / 2 BETWEEN 1 AND 10000)
  OR (content_format = ''rich_v1'' AND content_json IS NOT NULL AND ISJSON(content_json) = 1
      AND DATALENGTH(content) / 2 BETWEEN 0 AND 10000)
);');

CREATE TABLE dbo.upload_sessions (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_upload_sessions PRIMARY KEY,
  token_hash CHAR(64) NOT NULL CONSTRAINT UQ_upload_sessions_token UNIQUE,
  client_key CHAR(64) NOT NULL,
  target_post_id BIGINT NULL,
  author_hash VARCHAR(256) NULL,
  state VARCHAR(10) NOT NULL CONSTRAINT DF_upload_sessions_state DEFAULT 'active',
  file_count INT NOT NULL CONSTRAINT DF_upload_sessions_files DEFAULT 0,
  input_bytes BIGINT NOT NULL CONSTRAINT DF_upload_sessions_bytes DEFAULT 0,
  created_at DATETIME2(3) NOT NULL CONSTRAINT DF_upload_sessions_created DEFAULT SYSUTCDATETIME(),
  expires_at DATETIME2(3) NOT NULL,
  CONSTRAINT CK_upload_sessions_state CHECK (state IN ('active', 'consumed', 'cancelled', 'expired')),
  CONSTRAINT CK_upload_sessions_files CHECK (file_count BETWEEN 0 AND 5),
  CONSTRAINT CK_upload_sessions_bytes CHECK (input_bytes BETWEEN 0 AND 20971520),
  CONSTRAINT CK_upload_sessions_target CHECK (
    (target_post_id IS NULL AND author_hash IS NULL)
    OR (target_post_id IS NOT NULL AND author_hash IS NOT NULL AND target_post_id BETWEEN 1 AND 9007199254740991)
  ),
  CONSTRAINT CK_upload_sessions_expiry CHECK (expires_at > created_at)
);
CREATE INDEX IX_upload_sessions_expires ON dbo.upload_sessions(expires_at);

CREATE TABLE dbo.image_assets (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_image_assets PRIMARY KEY,
  session_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_image_assets_session REFERENCES dbo.upload_sessions(id),
  post_id BIGINT NULL CONSTRAINT FK_image_assets_post REFERENCES dbo.posts(id),
  idempotency_key UNIQUEIDENTIFIER NOT NULL,
  state VARCHAR(12) NOT NULL,
  blob_name NVARCHAR(120) NOT NULL CONSTRAINT UQ_image_assets_blob UNIQUE,
  input_sha256 CHAR(64) NULL,
  input_bytes INT NOT NULL CONSTRAINT DF_image_assets_input DEFAULT 0,
  stored_bytes INT NOT NULL CONSTRAINT DF_image_assets_stored DEFAULT 0,
  charge_bytes BIGINT NOT NULL CONSTRAINT DF_image_assets_charge DEFAULT 5242880,
  width INT NOT NULL CONSTRAINT DF_image_assets_width DEFAULT 0,
  height INT NOT NULL CONSTRAINT DF_image_assets_height DEFAULT 0,
  blob_write_started BIT NOT NULL CONSTRAINT DF_image_assets_write DEFAULT 0,
  created_at DATETIME2(3) NOT NULL CONSTRAINT DF_image_assets_created DEFAULT SYSUTCDATETIME(),
  lease_until DATETIME2(3) NOT NULL,
  attached_at DATETIME2(3) NULL,
  deleted_at DATETIME2(3) NULL,
  purge_after DATETIME2(3) NULL,
  CONSTRAINT UQ_image_assets_idempotency UNIQUE (session_id, idempotency_key),
  CONSTRAINT CK_image_assets_state CHECK (state IN ('uploading', 'ready', 'attached', 'deleting', 'soft_deleted', 'purged')),
  CONSTRAINT CK_image_assets_post CHECK (
    (state = 'attached' AND post_id IS NOT NULL) OR (state <> 'attached' AND post_id IS NULL)
  ),
  CONSTRAINT CK_image_assets_input CHECK (input_bytes BETWEEN 0 AND 5242880),
  CONSTRAINT CK_image_assets_stored CHECK (stored_bytes BETWEEN 0 AND 5242880),
  CONSTRAINT CK_image_assets_charge CHECK (charge_bytes >= 0),
  CONSTRAINT CK_image_assets_dimensions CHECK (width BETWEEN 0 AND 1920 AND height BETWEEN 0 AND 1920)
);
CREATE INDEX IX_image_assets_post_state ON dbo.image_assets(post_id, state);
CREATE INDEX IX_image_assets_state_created ON dbo.image_assets(state, created_at);

CREATE TABLE dbo.media_capacity (
  id TINYINT NOT NULL CONSTRAINT PK_media_capacity PRIMARY KEY,
  occupied_bytes BIGINT NOT NULL CONSTRAINT DF_media_capacity_bytes DEFAULT 0,
  CONSTRAINT CK_media_capacity_id CHECK (id = 1),
  CONSTRAINT CK_media_capacity_bytes CHECK (occupied_bytes BETWEEN 0 AND 1073741824)
);
INSERT dbo.media_capacity(id) VALUES(1);

CREATE TABLE dbo.media_buckets (
  kind VARCHAR(8) NOT NULL,
  client_key CHAR(64) NOT NULL,
  generation UNIQUEIDENTIFIER NOT NULL,
  attempts_used INT NOT NULL CONSTRAINT DF_media_buckets_used DEFAULT 0,
  attempts_pending INT NOT NULL CONSTRAINT DF_media_buckets_pending DEFAULT 0,
  bytes_used BIGINT NOT NULL CONSTRAINT DF_media_buckets_bytes_used DEFAULT 0,
  bytes_pending BIGINT NOT NULL CONSTRAINT DF_media_buckets_bytes_pending DEFAULT 0,
  started_at DATETIME2(3) NOT NULL,
  expires_at DATETIME2(3) NOT NULL,
  CONSTRAINT PK_media_buckets PRIMARY KEY (kind, client_key),
  CONSTRAINT CK_media_buckets_kind CHECK (kind IN ('session', 'file')),
  CONSTRAINT CK_media_buckets_counts CHECK (attempts_used >= 0 AND attempts_pending >= 0 AND bytes_used >= 0 AND bytes_pending >= 0),
  CONSTRAINT CK_media_buckets_expiry CHECK (expires_at > started_at)
);
CREATE INDEX IX_media_buckets_expires ON dbo.media_buckets(expires_at);

CREATE TABLE dbo.media_reservations (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_media_reservations PRIMARY KEY,
  kind VARCHAR(8) NOT NULL,
  client_key CHAR(64) NOT NULL,
  generation UNIQUEIDENTIFIER NOT NULL,
  bytes_reserved BIGINT NOT NULL CONSTRAINT DF_media_reservations_bytes DEFAULT 0,
  expires_at DATETIME2(3) NOT NULL,
  state VARCHAR(8) NOT NULL,
  received_bytes BIGINT NOT NULL CONSTRAINT DF_media_reservations_received DEFAULT 0,
  CONSTRAINT FK_media_reservations_bucket FOREIGN KEY (kind, client_key) REFERENCES dbo.media_buckets(kind, client_key),
  CONSTRAINT CK_media_reservations_state CHECK (state IN ('pending', 'finished')),
  CONSTRAINT CK_media_reservations_bytes CHECK (bytes_reserved >= 0 AND received_bytes BETWEEN 0 AND bytes_reserved)
);
CREATE INDEX IX_media_reservations_expires ON dbo.media_reservations(state, expires_at);

CREATE TABLE dbo.image_delete_jobs (
  asset_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_image_delete_jobs PRIMARY KEY
    CONSTRAINT FK_image_delete_jobs_asset REFERENCES dbo.image_assets(id),
  available_at DATETIME2(3) NOT NULL CONSTRAINT DF_image_delete_jobs_available DEFAULT SYSUTCDATETIME(),
  attempts INT NOT NULL CONSTRAINT DF_image_delete_jobs_attempts DEFAULT 0,
  lease_owner UNIQUEIDENTIFIER NULL,
  lease_until DATETIME2(3) NULL,
  last_error_code VARCHAR(40) NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT DF_image_delete_jobs_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_image_delete_jobs_attempts CHECK (attempts >= 0),
  CONSTRAINT CK_image_delete_jobs_error CHECK (last_error_code IS NULL OR last_error_code IN ('BLOB_UNAVAILABLE', 'DB_UNAVAILABLE', 'LEASE_LOST'))
);
CREATE INDEX IX_image_delete_jobs_available ON dbo.image_delete_jobs(available_at, lease_until);

CREATE TABLE dbo.media_maintenance (
  name VARCHAR(40) NOT NULL CONSTRAINT PK_media_maintenance PRIMARY KEY,
  owner UNIQUEIDENTIFIER NULL,
  lease_until DATETIME2(3) NULL
);
INSERT dbo.media_maintenance(name) VALUES('image-cleanup');
