import { ModelOutputError } from "@aihot/backend/providers/llm";
import { BudgetExceededError, ReceiptBusyError, ReceiptUnknownError,ProviderRejectedError } from "@aihot/backend/providers/receipts";

export function paperTaskWaits(error: unknown): boolean {
  return error instanceof BudgetExceededError || error instanceof ReceiptBusyError || error instanceof ReceiptUnknownError;
}

export function paperTaskFailure(error: unknown) {
  const receiptId = error instanceof ReceiptUnknownError || error instanceof ModelOutputError ? error.receiptId : null;
  const message = error instanceof BudgetExceededError ? "服务请求预算暂时不足，等待额度恢复后自动继续。"
    : error instanceof ReceiptUnknownError ? "请求已发送但结果尚未取回，等待回执恢复，暂不重复请求。"
    : error instanceof ReceiptBusyError ? "同一请求正在执行，等待已有回执。"
    : error instanceof ProviderRejectedError && error.status===429 ? "供应商限流（HTTP 429），队列会有限重试；重试耗尽后需检查服务或手动继续。"
    : error instanceof ProviderRejectedError && error.retryable ? `供应商暂时不可用（HTTP ${error.status}），队列会有限重试；重试耗尽后需检查服务或手动继续。`
    : error instanceof ModelOutputError && /finish_reason=length/.test(error.message) ? "模型在输出完整解读前达到输出长度上限，本次未发布。请检查模型思考模式与输出额度配置后重试。"
    : error instanceof ModelOutputError && /returned unusable output/.test(error.message) ? `模型回答未通过解读结构校验${error.outputIssue?'：'+error.outputIssue:''}，本次未发布。失败回执已保留，需检查字段要求或模型回答后重试。`
    : error instanceof Error ? error.message : "论文任务失败";
  return { error: message.replace(/\s+/g, " ").slice(0, 400), receipt_id: receiptId };
}
