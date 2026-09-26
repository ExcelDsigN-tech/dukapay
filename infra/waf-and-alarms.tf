resource "aws_wafv2_web_acl" "alb" {
  name  = "dukapay-alb-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesKnownBadInputsRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesSQLiRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "DukapayALBWAFMetric"
    sampled_requests_enabled   = true
  }

  tags = {
    Name        = "dukapay-alb-waf"
    Environment = var.environment
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.alb.arn
}

resource "aws_sns_topic" "alb_alarms" {
  name = "dukapay-alb-alarms-${var.environment}"

  tags = {
    Name        = "dukapay-alb-alarms"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx_rate" {
  alarm_name          = "dukapay-alb-5xx-rate-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 1

  metric_query {
    id          = "error_rate"
    expression  = "100 * errors / MAX([errors, requests])"
    label       = "5xx Error Rate (%)"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.main.arn_suffix
      }
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.main.arn_suffix
      }
    }
  }

  alarm_description = "ALB 5xx error rate exceeded 1% over two consecutive minutes"
  alarm_actions     = [aws_sns_topic.alb_alarms.arn]
  ok_actions        = [aws_sns_topic.alb_alarms.arn]

  tags = {
    Name        = "dukapay-alb-5xx-rate"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_p99_latency" {
  alarm_name          = "dukapay-alb-p99-latency-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 2

  namespace   = "AWS/ApplicationELB"
  metric_name = "TargetResponseTime"
  period      = 60
  statistic   = "p99"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_description = "ALB p99 response time exceeded 2 seconds over two consecutive minutes"
  alarm_actions     = [aws_sns_topic.alb_alarms.arn]
  ok_actions        = [aws_sns_topic.alb_alarms.arn]

  tags = {
    Name        = "dukapay-alb-p99-latency"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy_hosts" {
  alarm_name          = "dukapay-alb-unhealthy-hosts-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0

  namespace   = "AWS/ApplicationELB"
  metric_name = "UnHealthyHostCount"
  period      = 60
  statistic   = "Maximum"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.blue.arn_suffix
  }

  alarm_description = "One or more ALB target hosts are unhealthy"
  alarm_actions     = [aws_sns_topic.alb_alarms.arn]
  ok_actions        = [aws_sns_topic.alb_alarms.arn]

  tags = {
    Name        = "dukapay-alb-unhealthy-hosts"
    Environment = var.environment
  }
}

output "alb_waf_arn" {
  value = aws_wafv2_web_acl.alb.arn
}

output "alb_alarms_sns_topic_arn" {
  value = aws_sns_topic.alb_alarms.arn
}
