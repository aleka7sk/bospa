package bospa

import (
	"context"
	"fmt"
)

func (s *Store) ListUsers(ctx context.Context, workspaceID string) ([]User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, workspace_id::text, email::text, name, short_name, role, active, created_at
		FROM users
		WHERE workspace_id = $1
		ORDER BY active DESC, role, name`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace users: %w", err)
	}
	defer rows.Close()

	users := make([]User, 0)
	for rows.Next() {
		var user User
		if err := rows.Scan(
			&user.ID,
			&user.WorkspaceID,
			&user.Email,
			&user.Name,
			&user.ShortName,
			&user.Role,
			&user.Active,
			&user.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan workspace user: %w", err)
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspace users: %w", err)
	}
	return users, nil
}
