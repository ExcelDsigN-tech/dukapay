#!/bin/bash

set -euo pipefail

ENVIRONMENT=${1:-staging}

echo "Starting rollback for environment: $ENVIRONMENT"

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
  PREVIOUS_COLOR="green"
  PREVIOUS_SERVICE="dukapay-backend-green"
else
  PREVIOUS_COLOR="blue"
  PREVIOUS_SERVICE="dukapay-backend-blue"
fi

echo "Current active environment: $ACTIVE_COLOR"
echo "Rolling back to previous environment: $PREVIOUS_COLOR"

PREVIOUS_DESIRED_COUNT=$(aws ecs describe-services \
  --cluster dukapay-$ENVIRONMENT \
  --services "$PREVIOUS_SERVICE" \
  --query 'services[0].desiredCount' \
  --output text)

if [ "$PREVIOUS_DESIRED_COUNT" == "0" ]; then
  echo "ERROR: Previous environment has 0 tasks. Cannot rollback."
  echo "Run a fresh deployment instead."
  exit 1
fi

echo "Previous environment still has $PREVIOUS_DESIRED_COUNT tasks running"
echo "Switching traffic back to $PREVIOUS_COLOR..."

if [ "$PREVIOUS_COLOR" == "blue" ]; then
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

echo "Traffic switched back to $PREVIOUS_COLOR environment"
echo "Rollback completed successfully"
