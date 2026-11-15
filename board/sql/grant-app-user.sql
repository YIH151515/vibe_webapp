GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.posts TO [board_app];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.rate_buckets TO [board_app];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.admin_sessions TO [board_app];
GRANT SELECT ON OBJECT::dbo.schema_migrations TO [board_app];
