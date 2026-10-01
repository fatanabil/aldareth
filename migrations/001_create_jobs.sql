CREATE TABLE IF NOT EXISTS `{{prefix}}jobs` (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    queue         VARCHAR(100) NOT NULL DEFAULT 'default',
    name          VARCHAR(150) NOT NULL,
    payload       LONGTEXT NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts      INT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts  INT UNSIGNED NOT NULL DEFAULT 3,
    available_at  DATETIME NOT NULL,
    locked_until  DATETIME NULL,
    locked_by     VARCHAR(100) NULL,
    lock_token    CHAR(36) NULL,
    last_error    TEXT NULL,
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL,
    KEY idx_claim (queue, status, available_at, id),
    KEY idx_recover (status, locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;