# Database Migrations for Blue-Green Deployments

## Backward Compatibility Requirements

All database migrations MUST be backward compatible to support blue-green deployments with zero downtime.

### Rules for Backward Compatible Migrations

1. **Adding Columns**
   - Always add columns as nullable or with default values
   - Never add NOT NULL columns without defaults

   ```sql
   -- Good
   ALTER TABLE loans ADD COLUMN new_field VARCHAR(255) DEFAULT 'default_value';

   -- Bad
   ALTER TABLE loans ADD COLUMN new_field VARCHAR(255) NOT NULL;
   ```

2. **Removing Columns**
   - Use a two-phase approach:
     - Phase 1: Stop using the column in code, deploy
     - Phase 2: Remove the column in next deployment

   ```sql
   -- Phase 1: No migration, just stop using in code
   -- Phase 2: After deployment is stable
   ALTER TABLE loans DROP COLUMN old_field;
   ```

3. **Renaming Columns**
   - Use a three-phase approach:
     - Phase 1: Add new column, copy data
     - Phase 2: Update code to use new column
     - Phase 3: Remove old column

   ```sql
   -- Phase 1
   ALTER TABLE loans ADD COLUMN new_name VARCHAR(255);
   UPDATE loans SET new_name = old_name;

   -- Phase 2: Deploy code using new_name

   -- Phase 3: After deployment is stable
   ALTER TABLE loans DROP COLUMN old_name;
   ```

4. **Changing Column Types**
   - Use a similar approach to renaming
   - Add new column with new type
   - Migrate data
   - Update code
   - Remove old column

5. **Adding Constraints**
   - Add constraints as NOT VALID first
   - Validate in a separate transaction

   ```sql
   -- Phase 1
   ALTER TABLE loans ADD CONSTRAINT check_amount
     CHECK (amount > 0) NOT VALID;

   -- Phase 2: Validate without locking
   ALTER TABLE loans VALIDATE CONSTRAINT check_amount;
   ```

6. **Adding Indexes**
   - Use CONCURRENTLY to avoid locking

   ```sql
   CREATE INDEX CONCURRENTLY idx_loans_status ON loans(status);
   ```

### Migration Checklist

Before deploying any migration, verify:

- [ ] Migration can run while old code is still active
- [ ] Migration can run while new code is already active
- [ ] No data loss occurs
- [ ] No downtime is caused
- [ ] Rollback strategy is documented
- [ ] Migration is tested on staging with both old and new code versions

### Testing Backward Compatibility

```bash
# Test with old code version
git checkout old-version
npm run migrate
npm test

# Test with new code version
git checkout new-version
npm test
npm run migrate
npm test
```

## Rollback Procedures

If a deployment needs to be rolled back:

1. Traffic is switched back to previous environment
2. Database remains in current state
3. Previous code version must work with current database schema
4. This is why backward compatibility is critical
