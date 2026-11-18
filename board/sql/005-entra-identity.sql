CREATE TABLE dbo.board_users (
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  object_id UNIQUEIDENTIFIER NOT NULL,
  display_name NVARCHAR(256) NOT NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT DF_board_users_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_board_users_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_board_users PRIMARY KEY (tenant_id,object_id),
  CONSTRAINT CK_board_users_name CHECK (DATALENGTH(display_name)/2 BETWEEN 1 AND 256)
);
CREATE TABLE dbo.auth_sessions (
  id_hash CHAR(64) NOT NULL CONSTRAINT PK_auth_sessions PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  object_id UNIQUEIDENTIFIER NOT NULL,
  display_name NVARCHAR(256) NOT NULL,
  is_admin BIT NOT NULL,
  app_origin NVARCHAR(256) NOT NULL,
  client_id UNIQUEIDENTIFIER NOT NULL,
  created_at DATETIME2(3) NOT NULL,
  expires_at DATETIME2(3) NOT NULL,
  revoked_at DATETIME2(3) NULL,
  CONSTRAINT FK_auth_sessions_user FOREIGN KEY (tenant_id,object_id) REFERENCES dbo.board_users(tenant_id,object_id),
  CONSTRAINT UQ_auth_sessions_owner UNIQUE (id_hash,tenant_id,object_id),
  CONSTRAINT CK_auth_sessions_hash CHECK (id_hash COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_auth_sessions_name CHECK (DATALENGTH(display_name)/2 BETWEEN 1 AND 256),
  CONSTRAINT CK_auth_sessions_origin CHECK (DATALENGTH(app_origin)/2 BETWEEN 1 AND 256),
  CONSTRAINT CK_auth_sessions_expiry CHECK (expires_at>created_at AND expires_at<=DATEADD(hour,1,created_at))
);
CREATE INDEX IX_auth_sessions_expiry ON dbo.auth_sessions(expires_at);
CREATE INDEX IX_auth_sessions_account ON dbo.auth_sessions(tenant_id,object_id,revoked_at,expires_at);
CREATE TABLE dbo.oidc_login_attempts (
  state_hash CHAR(64) NOT NULL CONSTRAINT PK_oidc_login_attempts PRIMARY KEY,
  browser_hash CHAR(64) NOT NULL,
  client_id UNIQUEIDENTIFIER NOT NULL,
  app_origin NVARCHAR(256) NOT NULL,
  return_to NVARCHAR(2048) NOT NULL,
  secret_cipher VARBINARY(2048) NOT NULL,
  crypto_key_id CHAR(16) NOT NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT DF_oidc_login_attempts_created DEFAULT SYSUTCDATETIME(),
  expires_at DATETIME2(3) NOT NULL,
  CONSTRAINT CK_oidc_login_attempts_hashes CHECK (
    state_hash COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%' AND
    browser_hash COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%' AND
    crypto_key_id COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_oidc_login_attempts_origin CHECK (DATALENGTH(app_origin)/2 BETWEEN 1 AND 256),
  CONSTRAINT CK_oidc_login_attempts_return CHECK (DATALENGTH(return_to)/2 BETWEEN 1 AND 2048),
  CONSTRAINT CK_oidc_login_attempts_cipher CHECK (DATALENGTH(secret_cipher) BETWEEN 30 AND 2048),
  CONSTRAINT CK_oidc_login_attempts_expiry CHECK (expires_at>created_at AND expires_at<=DATEADD(minute,10,created_at))
);
CREATE INDEX IX_oidc_login_attempts_expiry ON dbo.oidc_login_attempts(expires_at);

ALTER TABLE dbo.posts DROP CONSTRAINT CK_posts_nickname;
ALTER TABLE dbo.posts ALTER COLUMN nickname NVARCHAR(256) NOT NULL;
ALTER TABLE dbo.posts DROP CONSTRAINT CK_posts_password_hash;
ALTER TABLE dbo.posts ALTER COLUMN password_hash VARCHAR(256) NULL;
ALTER TABLE dbo.posts ADD author_tenant_id UNIQUEIDENTIFIER NULL, author_object_id UNIQUEIDENTIFIER NULL;
-- New-column references must compile after ALTER TABLE, including on an existing schema4 DB.
EXEC(N'ALTER TABLE dbo.posts ADD
  CONSTRAINT CK_posts_nickname CHECK (DATALENGTH(nickname)/2 BETWEEN 1 AND 256),
  CONSTRAINT CK_posts_password_hash CHECK (DATALENGTH(password_hash) BETWEEN 1 AND 256),
  CONSTRAINT CK_posts_author CHECK (
    (author_tenant_id IS NULL AND author_object_id IS NULL AND password_hash IS NOT NULL) OR
    (author_tenant_id IS NOT NULL AND author_object_id IS NOT NULL AND password_hash IS NULL)),
  CONSTRAINT FK_posts_author FOREIGN KEY(author_tenant_id,author_object_id) REFERENCES dbo.board_users(tenant_id,object_id);
  CREATE INDEX IX_posts_author ON dbo.posts(author_tenant_id,author_object_id,created_at,id);');

ALTER TABLE dbo.upload_sessions ADD owner_tenant_id UNIQUEIDENTIFIER NULL, owner_object_id UNIQUEIDENTIFIER NULL, auth_session_hash CHAR(64) NULL;
ALTER TABLE dbo.upload_sessions DROP CONSTRAINT CK_upload_sessions_target;
EXEC(N'ALTER TABLE dbo.upload_sessions ADD
  CONSTRAINT CK_upload_sessions_owner CHECK (
    (owner_tenant_id IS NULL AND owner_object_id IS NULL AND auth_session_hash IS NULL) OR
    (owner_tenant_id IS NOT NULL AND owner_object_id IS NOT NULL AND auth_session_hash IS NOT NULL AND author_hash IS NULL)),
  CONSTRAINT CK_upload_sessions_auth_hash CHECK (auth_session_hash IS NULL OR auth_session_hash COLLATE Latin1_General_100_BIN2 NOT LIKE ''%[^0-9a-f]%''),
  CONSTRAINT CK_upload_sessions_target CHECK (
    (target_post_id IS NULL AND author_hash IS NULL) OR
    (target_post_id IS NOT NULL AND (author_hash IS NOT NULL OR (owner_tenant_id IS NOT NULL AND owner_object_id IS NOT NULL)))),
  CONSTRAINT FK_upload_sessions_owner FOREIGN KEY(owner_tenant_id,owner_object_id) REFERENCES dbo.board_users(tenant_id,object_id),
  CONSTRAINT FK_upload_sessions_auth FOREIGN KEY(auth_session_hash,owner_tenant_id,owner_object_id)
    REFERENCES dbo.auth_sessions(id_hash,tenant_id,object_id);
  CREATE INDEX IX_upload_sessions_auth ON dbo.upload_sessions(auth_session_hash,state);');

ALTER TABLE dbo.rate_buckets DROP CONSTRAINT CK_rate_buckets_action;
ALTER TABLE dbo.rate_buckets ADD CONSTRAINT CK_rate_buckets_action CHECK (action IN ('post-create','post-password','admin-login','oidc-login'));
