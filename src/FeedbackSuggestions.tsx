import { useEffect, useId, useReducer, useRef } from "react";
import { LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import {
  suggestFeedback,
  type FeedbackSuggestion,
  type FeedbackSuggestionField,
  type GenerateRequest,
} from "./api";
import { feedbackInputErrors } from "./feedbackModel";
import "./FeedbackSuggestions.css";

interface Props {
  input: GenerateRequest;
  lessonAt?: string;
  disabled?: boolean;
  onApply: (field: FeedbackSuggestionField, text: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

const LABELS: Record<FeedbackSuggestionField, string> = {
  performance: "课堂情况",
  strengths: "值得肯定",
  difficulties: "需要关注",
  plan: "后续建议",
};

// Compare all request fields; object insertion order alone must not invalidate a request.
export function suggestionInputKey(input: GenerateRequest, lessonAt = ""): string {
  return JSON.stringify([
    input.module, input.grade, input.styleReference ?? "", lessonAt,
    input.brief.periodStart, input.brief.periodEnd, input.brief.subjects,
    input.brief.teachingContent, input.brief.commonTasks, input.brief.focus,
    input.brief.length,
    input.observations.performance, input.observations.strengths,
    input.observations.difficulties, input.observations.plan, input.observations.tasks,
    Object.entries(input.observations.subjects).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

interface SuggestionsState {
  key: string;
  requestId: number;
  busy: boolean;
  suggestions: FeedbackSuggestion[];
  error: string;
  notice: string;
}

type SuggestionsAction =
  | { type: "input"; key: string }
  | { type: "clear"; key: string; notice?: string }
  | { type: "start"; key: string; requestId: number }
  | { type: "success"; key: string; requestId: number; suggestions: FeedbackSuggestion[] }
  | { type: "failure"; key: string; requestId: number; message: string }
  | { type: "apply"; key: string; requestId: number };

export function createSuggestionsState(key: string): SuggestionsState {
  return { key, requestId: 0, busy: false, suggestions: [], error: "", notice: "" };
}

export function suggestionsReducer(state: SuggestionsState, action: SuggestionsAction): SuggestionsState {
  if (action.type === "input")
    return state.key === action.key ? state : createSuggestionsState(action.key);
  if (action.type === "clear")
    return { ...createSuggestionsState(action.key), notice: action.notice ?? "" };
  if (action.type === "start")
    return { ...createSuggestionsState(action.key), requestId: action.requestId, busy: true };
  if (state.key !== action.key || state.requestId !== action.requestId) return state;
  if (action.type === "success") {
    if (!state.busy) return state;
    return { ...state, busy: false, suggestions: action.suggestions, notice: action.suggestions.length ? "请逐条核对，只加入符合实际情况的内容。" : "目前没有新的可选建议，可以补充真实观察后重试。" };
  }
  if (action.type === "failure") {
    if (!state.busy) return state;
    return { ...state, busy: false, error: action.message };
  }
  if (state.busy || !state.suggestions.length) return state;
  return { ...state, suggestions: [], notice: "已交给对应记录栏，请核对内容。本轮候选已清空。" };
}

export default function FeedbackSuggestions({ input, lessonAt, disabled = false, onApply, onBusyChange }: Props) {
  const titleId = useId();
  const hintId = useId();
  const validationId = useId();
  const inputKey = suggestionInputKey(input, lessonAt);
  const [state, dispatch] = useReducer(suggestionsReducer, inputKey, createSuggestionsState);
  const latestKey = useRef(inputKey);
  const disabledRef = useRef(disabled);
  const callbackRef = useRef(onBusyChange);
  latestKey.current = inputKey;
  disabledRef.current = disabled;
  callbackRef.current = onBusyChange;
  const sequence = useRef(0);
  const active = useRef<{ key: string; id: number; controller: AbortController } | null>(null);
  const applied = useRef<number | null>(null);
  const validationErrors = feedbackInputErrors(input, { lessonAt, requirePersonalFacts: true });
  const visible = state.key === inputKey && !disabled && !validationErrors.length;
  const busy = visible && state.busy;

  useEffect(() => {
    if (active.current && active.current.key !== inputKey) {
      active.current.controller.abort();
      active.current = null;
    }
    dispatch({ type: "input", key: inputKey });
  }, [inputKey]);

  useEffect(() => {
    if (!disabled) return;
    active.current?.controller.abort();
    active.current = null;
    dispatch({ type: "clear", key: latestKey.current });
  }, [disabled]);

  useEffect(() => {
    callbackRef.current?.(busy);
  }, [busy]);

  useEffect(() => () => {
    active.current?.controller.abort();
    active.current = null;
    callbackRef.current?.(false);
  }, []);

  async function getSuggestions() {
    if (disabled || validationErrors.length || active.current) return;
    const request = { key: inputKey, id: ++sequence.current, controller: new AbortController() };
    active.current = request;
    dispatch({ type: "start", key: request.key, requestId: request.id });
    try {
      const result = await suggestFeedback(input, request.controller.signal);
      if (active.current !== request || latestKey.current !== request.key || disabledRef.current) return;
      dispatch({ type: "success", key: request.key, requestId: request.id, suggestions: result.suggestions });
    } catch (error) {
      if (active.current !== request || latestKey.current !== request.key || disabledRef.current || request.controller.signal.aborted) return;
      dispatch({ type: "failure", key: request.key, requestId: request.id, message: error instanceof Error ? error.message : "获取推荐未完成，请稍后重试。" });
    } finally {
      if (active.current === request) active.current = null;
    }
  }

  function cancel() {
    active.current?.controller.abort();
    active.current = null;
    dispatch({ type: "clear", key: inputKey, notice: "已取消获取推荐，原始记录保持不变。" });
  }

  function apply(suggestion: FeedbackSuggestion) {
    if (!visible || busy || applied.current === state.requestId || !state.suggestions.includes(suggestion)) return;
    applied.current = state.requestId;
    dispatch({ type: "apply", key: inputKey, requestId: state.requestId });
    onApply(suggestion.field, suggestion.text);
  }

  return (
    <section className="feedback-suggestions" aria-labelledby={titleId} aria-busy={busy}>
      <div className="feedback-suggestions-heading">
        <h4 id={titleId}><Sparkles size={15} aria-hidden="true" />AI 推荐记录</h4>
        {busy ? <button type="button" className="button button-ghost button-sm" onClick={cancel}><X size={14} aria-hidden="true" />取消</button> : null}
      </div>
      <p className="feedback-suggestions-hint" id={hintId}>只参考已有事实改写和提出后续建议，不推断实际表现。请教师核对，点击后才加入记录。</p>
      <button type="button" className="button button-secondary button-sm feedback-suggestions-request" disabled={disabled || validationErrors.length > 0 || busy} aria-describedby={`${hintId} ${validationId}`} onClick={() => void getSuggestions()}>
        {busy ? <LoaderCircle className="feedback-suggestions-spinner" size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
        {busy ? "正在获取推荐…" : "根据已填事实获取推荐"}
      </button>
      <div id={validationId} aria-live="polite">
        {validationErrors.map((message) => <p className="feedback-suggestions-error" key={message}>{message}</p>)}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {visible && state.error && <p className="feedback-suggestions-error" role="alert">{state.error}</p>}
        {visible && state.notice && <p className="feedback-suggestions-notice">{state.notice}</p>}
      </div>
      {visible && state.suggestions.length > 0 && <ul className="feedback-suggestions-list">
        {state.suggestions.map((suggestion, index) => <li key={`${state.requestId}-${index}`}>
          <span className="feedback-suggestions-category">{LABELS[suggestion.field]}</span>
          <p>{suggestion.text}</p>
          <button type="button" className="button button-ghost button-sm" onClick={() => apply(suggestion)} aria-label={`加入${LABELS[suggestion.field]}记录：${suggestion.text}`}><Plus size={14} aria-hidden="true" />加入记录</button>
        </li>)}
      </ul>}
    </section>
  );
}
