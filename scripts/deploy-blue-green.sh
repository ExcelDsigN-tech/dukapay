#!/bin/bash

set -euo pipefail

ENVIRONMENT=${1:-staging}
NEW_VERSION=${2:-latest}
ROLLBACK_WINDOW=${3:-600}

echo "Starting blue-green deployment for environment: $ENVIRONMENT"
echo "New version: $NEW_VERSION"
echo "Rollback window: ${ROLLBACK_WINDOW}s"

get_active_color() {
  BLUE_WEIGHT=$(aws elbv2 describe-listener-rules \
    --listener-arn "$LISTENER_ARN" \
    --query 'Rules[0].Actions[0].ForwardConfig.TargetGroups[?TargetGroupArn==`'$BLUE_TG_ARN'`].Weight' \
    --output text)
  
  if [ "$BLUE_WEIGHT" == "100" ]; then
    echo "blue"
  else
    echo "green"
  fi
}

ACTIVE_COLOR=$(get_active_color)
if [ "$ACTIVE_COLOR" == "blue" ]; then
  INACTIVE_COLOR="green"
  INACTIVE_TG_ARN="$GREEN_TG_ARN"
  INACTIVE_SERVICE="dukapay-backend-green"
else
  INACTIVE_COLOR="blue"
  INACTIVE_TG_ARN="$BLUE_TG_ARN"
  INACTIVE_SERVICE="dukapay-backend-blue"
fi

echo "Active environment: $ACTIVE_COLOR"
echo "Deploying to inactive environment: $INACTIVE_COLOR"

echo "Updating task definition for $INACTIVE_COLOR environment..."
aws ecs update-service \
  --cluster dukapay-$ENVIRONMENT \
  --service "$INACTIVE_SERVICE" \
  --task-definition "dukapay-backend:$NEW_VERSION" \
  --desired-count 2

echo "Waiting for service to become healthy..."
aws ecs wait services-stable \
  --cluster dukapay-$ENVIRONMENT \
  --services "$INACTIVE_SERVICE"

echo "Running health checks on inactive environment..."
HEALTH_CHECK_URL=$(aws elbv2 describe-target-groups \
  --target-group-arns "$INACTIVE_TG_ARN" \
  --query 'TargetGroups[0].HealthCheckPath' \
  --output text)

for i in {1..10}; do
  HEALTH_STATUS=$(aws elbv2 describe-target-health \
    --target-group-arn "$INACTIVE_TG_ARN" \
    --query 'TargetHealthDescriptions[0].TargetHealth.State' \
    --output text)
  
  if [ "$HEALTH_STATUS" == "healthy" ]; then
    echo "Health check passed"
    break
  fi
  
  echo "Waiting for health check (attempt $i/10)..."
  sleep 10
done

if [ "$HEALTH_STATUS" != "healthy" ]; then
  echo "Health check failed. Aborting deployment."
  exit 1
fi

echo "Running smoke tests..."
if ! bash scripts/smoke-tests.sh "$INACTIVE_COLOR"; then
  echo "Smoke tests failed. Aborting deployment."
  exit 1
fi

echo "Switching traffic to $INACTIVE_COLOR environment..."
if [ "$INACTIVE_COLOR" == "blue" ]; then
  NEW_BLUE_WEIGHT=100
  NEW_GREEN_WEIGHT=0
else
  NEW_BLUE_WEIGHT=0
  NEW_GREEN_WEIGHT=100
fi

aws elbv2 modify-listener \
  --listener-arn "$LISTENER_ARN" \
  --default-actions Type=forward,ForwardConfig="{
    TargetGroups=[
      {TargetGroupArn=$BLUE_TG_ARN,Weight=$NEW_BLUE_WEIGHT},
      {TargetGroupArn=$GREEN_TG_ARN,Weight=$NEW_GREEN_WEIGHT}
    ]
  }"

echo "Traffic switched to $INACTIVE_COLOR environment"
echo "Keeping $ACTIVE_COLOR environment active for ${ROLLBACK_WINDOW}s for potential rollback"

sleep "$ROLLBACK_WINDOW"

echo "Scaling down old $ACTIVE_COLOR environment..."
if [ "$ACTIVE_COLOR" == "blue" ]; then
  OLD_SERVICE="dukapay-backend-blue"
else
  OLD_SERVICE="dukapay-backend-green"
fi

aws ecs update-service \
  --cluster dukapay-$ENVIRONMENT \
  --service "$OLD_SERVICE" \
  --desired-count 0

echo "Blue-green deployment completed successfully"
echo "New active environment: $INACTIVE_COLOR"
