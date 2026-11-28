# SQS queue for complaint events, with a dead-letter queue (proposal, Section 14).
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.project}-complaint-events-dlq"
  message_retention_seconds = 1209600 # 14 days, time to inspect failures
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "events" {
  name                       = "${var.project}-complaint-events"
  visibility_timeout_seconds = var.visibility_timeout_seconds # at least 6x the Lambda timeout (AWS guidance)
  message_retention_seconds  = 345600                         # 4 days
  receive_wait_time_seconds  = 20                             # long polling
  sqs_managed_sse_enabled    = true                           # encryption at rest

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.events.arn]
  })
}
