import { useEffect, useId, useReducer, useRef } from "react";
import { Check, ChevronDown, LoaderCircle, Save, Trash2 } from "lucide-react";
import type { ModuleId } from "./types";
import "./FeedbackStyleReference.css";

export interface FeedbackStyleReferenceProps {
  module: ModuleId;
  value: string;
  onSave: (value: string) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
}

const MODULE_NAMES: Record<ModuleId, string> = {
  "one-to-one": "一对一", evening: "晚辅", course: "班课",
};

export interface StyleReferenceState {
  draft: string;
  savedValue: string;
  externalValue: string | null;
  saving: boolean;
  submitted: string | null;
  notice: { message: string; error?: boolean } | null;
}

export type StyleReferenceAction =
  | { type: "edit"; value: string }
  | { type: "external"; value: string }
  | { type: "save-start"; value: string }
  | { type: "save-success"; value: string }
  | { type: "save-failure"; message: string }
  | { type: "discard" }
  | { type: "load-external" };

export function createStyleReferenceState(value: string): StyleReferenceState {
  return { draft: value, savedValue: value, externalValue: null, saving: false, submitted: null, notice: null };
}

/** Keep local work visible when the parent receives a newer saved reference. */
export function styleReferenceReducer(state: StyleReferenceState, action: StyleReferenceAction): StyleReferenceState {
  switch (action.type) {
    case "edit":
      return state.saving ? state : { ...state, draft: action.value, notice: null };
    case "external":
      if (action.value === state.savedValue)
        return state.externalValue === null ? state : { ...state, externalValue: null };
      if (state.saving && action.value === state.submitted)
        return { ...state, externalValue: null };
      if (!state.saving && state.draft === state.savedValue)
        return createStyleReferenceState(action.value);
      return { ...state, externalValue: action.value };
    case "save-start":
      return state.saving ? state : { ...state, saving: true, submitted: action.value, notice: null };
    case "save-success":
      return {
        ...state, draft: action.value, savedValue: action.value, saving: false, submitted: null,
        externalValue: state.externalValue === action.value ? null : state.externalValue,
        notice: { message: action.value ? "风格参考已保存，将用于后续 AI 生成。" : "风格参考已清除，后续生成不再使用这份参考。" },
      };
    case "save-failure":
      return { ...state, saving: false, submitted: null, notice: { message: action.message, error: true } };
    case "discard":
      return state.saving ? state : createStyleReferenceState(state.externalValue ?? state.savedValue);
    case "load-external":
      return state.saving || state.externalValue === null ? state : createStyleReferenceState(state.externalValue);
  }
}

function StyleReferenceEditor({ module, value, onSave, onDirtyChange, disabled = false }: FeedbackStyleReferenceProps) {
  const [state, dispatch] = useReducer(styleReferenceReducer, value, createStyleReferenceState);
  const fieldId = useId();
  const savingRef = useRef(false);
  const aliveRef = useRef(true);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const dirty = state.draft !== state.savedValue;
  const locked = disabled || state.saving;
  const moduleName = MODULE_NAMES[module];

  useEffect(() => { dispatch({ type: "external", value }); }, [value]);
  useEffect(() => { dirtyCallback.current?.(dirty || state.saving); }, [dirty, state.saving]);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; dirtyCallback.current?.(false); };
  }, []);

  async function save() {
    if (disabled || savingRef.current || !dirty) return;
    if (state.draft.length > 12000) {
      dispatch({ type: "save-failure", message: "风格参考不能超过 12000 字，请精简后再保存。当前输入已保留。" });
      return;
    }
    const submitted = state.draft.trim();
    savingRef.current = true;
    dispatch({ type: "save-start", value: submitted });
    try {
      const ok = await onSave(submitted);
      if (!aliveRef.current) return;
      dispatch(ok
        ? { type: "save-success", value: submitted }
        : { type: "save-failure", message: "风格参考未保存成功，当前输入已保留。请处理页面提示后重试。" });
    } catch (error) {
      if (aliveRef.current) dispatch({
        type: "save-failure",
        message: `${error instanceof Error ? error.message : "保存失败，请稍后重试。"} 当前输入已保留。`,
      });
    } finally {
      savingRef.current = false;
    }
  }

  return <details className="style-reference">
    <summary>
      <span className="style-reference-title">个人风格参考</span>
      <span className={`style-reference-badge ${state.savedValue.trim() ? "is-set" : ""}`}>
        {state.savedValue.trim() ? "有参考" : "未设置"}
      </span>
      {(dirty || state.saving) && <span className="style-reference-dirty">{state.saving ? "保存中…" : "有未保存修改"}</span>}
      <ChevronDown size={17} className="style-reference-chevron" aria-hidden="true" />
    </summary>
    <div className="style-reference-body">
      <p className="style-reference-description">三个模块分别保存。本份参考供{moduleName}模块的所有学生{module === "one-to-one" ? "" : "和班级"}复用，保存后用于后续 AI 生成。</p>
      <label className="field" htmlFor={fieldId}>
        {moduleName}风格参考
        <textarea id={fieldId} rows={7} maxLength={12000} value={state.draft} readOnly={locked}
          aria-describedby={`${fieldId}-hint ${fieldId}-count`}
          placeholder="粘贴 1–3 份你满意的反馈范文，可以用空行分隔。"
          onChange={(event) => { if (!locked) dispatch({ type: "edit", value: event.target.value }); }} />
      </label>
      <div className="style-reference-guidance">
        <p id={`${fieldId}-hint`}>建议粘贴 1–3 份范文，用空行分隔；请先去掉姓名、联系方式等身份信息。AI 只学习表达方式，不照搬旧范文中的事实。</p>
        <span id={`${fieldId}-count`} className="style-reference-count">{state.draft.length} / 12000 字</span>
      </div>
      {state.externalValue !== null && <div className="style-reference-conflict" role="status">
        <p>已保存的参考在其他位置发生变化，当前输入仍保留。需要替换时，可明确加载最新参考。</p>
        <button type="button" className="button button-secondary button-sm" disabled={locked}
          onClick={() => dispatch({ type: "load-external" })}>放弃当前输入，加载最新参考</button>
      </div>}
      {state.notice && <p className={`style-reference-notice ${state.notice.error ? "is-error" : ""}`} role={state.notice.error ? "alert" : "status"}>
        {!state.notice.error && <Check size={15} aria-hidden="true" />}{state.notice.message}
      </p>}
      <div className="style-reference-actions">
        <span>输入不会自动保存；清空后保存即可移除参考。</span>
        <div>
          {dirty && <button type="button" className="button button-secondary button-sm" disabled={locked}
            onClick={() => dispatch({ type: "discard" })}>撤销修改</button>}
          <button type="button" className="button button-ghost button-sm" disabled={locked || !state.draft}
            onClick={() => dispatch({ type: "edit", value: "" })}><Trash2 size={15} />清空输入</button>
          <button type="button" className="button button-primary button-sm" disabled={locked || !dirty}
            onClick={() => void save()}>{state.saving ? <LoaderCircle size={15} className="style-reference-spinner" /> : <Save size={15} />}保存风格参考</button>
        </div>
      </div>
    </div>
  </details>;
}

/** The parent should honor onDirtyChange before navigating between modules. */
export default function FeedbackStyleReference(props: FeedbackStyleReferenceProps) {
  return <StyleReferenceEditor key={props.module} {...props} />;
}
