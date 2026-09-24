resource "aws_lb_target_group" "blue" {
  name     = "dukapay-backend-blue"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    enabled             = true
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = {
    Name        = "dukapay-backend-blue"
    Environment = var.environment
    Color       = "blue"
  }
}

resource "aws_lb_target_group" "green" {
  name     = "dukapay-backend-green"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    enabled             = true
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = {
    Name        = "dukapay-backend-green"
    Environment = var.environment
    Color       = "green"
  }
}

resource "aws_lb_listener_rule" "blue_green" {
  listener_arn = aws_lb_listener.main.arn
  priority     = 100

  action {
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.blue.arn
        weight = var.blue_weight
      }

      target_group {
        arn    = aws_lb_target_group.green.arn
        weight = var.green_weight
      }

      stickiness {
        enabled  = true
        duration = 600
      }
    }
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}

resource "aws_ecs_service" "blue" {
  name            = "dukapay-backend-blue"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend_blue.arn
  desired_count   = var.blue_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.backend.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.blue.arn
    container_name   = "dukapay-backend"
    container_port   = 3000
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }

  health_check_grace_period_seconds = 60

  tags = {
    Name        = "dukapay-backend-blue"
    Environment = var.environment
    Color       = "blue"
  }
}

resource "aws_ecs_service" "green" {
  name            = "dukapay-backend-green"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend_green.arn
  desired_count   = var.green_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.backend.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.green.arn
    container_name   = "dukapay-backend"
    container_port   = 3000
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }

  health_check_grace_period_seconds = 60

  tags = {
    Name        = "dukapay-backend-green"
    Environment = var.environment
    Color       = "green"
  }
}

variable "blue_weight" {
  description = "Traffic weight for blue environment (0-100)"
  type        = number
  default     = 100
}

variable "green_weight" {
  description = "Traffic weight for green environment (0-100)"
  type        = number
  default     = 0
}

variable "blue_desired_count" {
  description = "Desired task count for blue environment"
  type        = number
  default     = 2
}

variable "green_desired_count" {
  description = "Desired task count for green environment"
  type        = number
  default     = 0
}

output "blue_target_group_arn" {
  value = aws_lb_target_group.blue.arn
}

output "green_target_group_arn" {
  value = aws_lb_target_group.green.arn
}
