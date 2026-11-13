CREATE TABLE dbo.admin_sessions (
 id_hash CHAR(64) NOT NULL CONSTRAINT PK_admin_sessions PRIMARY KEY,
 created_at DATETIME2(3) NOT NULL CONSTRAINT DF_admin_sessions_created DEFAULT SYSUTCDATETIME(),
 expires_at DATETIME2(3) NOT NULL
);
CREATE INDEX IX_admin_sessions_expires ON dbo.admin_sessions(expires_at);
