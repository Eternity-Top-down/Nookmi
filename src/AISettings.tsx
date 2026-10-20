import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, PlugZap } from "lucide-react";
import { Modal } from "./components";
import {
  getAISettings,
  saveAISettings,
  testAIConnection,
  type AISettings as Settings,
} from "./api";

export default function AISettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getAISettings()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setBaseUrl(value.baseUrl);
        setModel(value.model);
        setError("");
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  async function save(test = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await saveAISettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        clearApiKey,
      });
      setSettings(value);
      setApiKey("");
      setClearApiKey(false);
      if (test) {
        const result = await testAIConnection();
        setMessage(result.message || "连接成功，可以开始生成反馈。");
      } else {
        setMessage("AI 配置已保存在本机。");
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "设置未保存，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="AI 服务设置"
      subtitle="配置一次，三个教学模块共用。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="settings-intro">
        支持兼容 OpenAI Chat Completions
        的服务。填写服务商提供的接口地址和模型名称；服务尚未准备好时，可以先保存原始记录。
      </p>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {!settings ? (
        <button
          className="button button-secondary"
          onClick={() => setLoadAttempt((value) => value + 1)}
        >
          重新读取设置
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="settings-fields" disabled={busy}>
            <label className="field">
              服务地址（Base URL）
              <input
                type="url"
                required
                maxLength={500}
                value={baseUrl}
                placeholder="https://你的服务地址/v1"
                onChange={(event) => setBaseUrl(event.target.value)}
                autoComplete="off"
              />
              <span className="field-hint">
                填写接口根地址，程序会追加 /chat/completions。远程服务请使用
                HTTPS。
              </span>
            </label>
            <label className="field">
              模型名称
              <input
                required
                maxLength={200}
                value={model}
                placeholder="填写服务商提供的模型 ID"
                onChange={(event) => setModel(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>
                <KeyRound size={15} /> API 密钥
              </span>
              <input
                type="password"
                maxLength={2000}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setClearApiKey(false);
                }}
                placeholder={
                  settings.hasApiKey
                    ? "已保存密钥，留空保持不变"
                    : "填写 API Key，本地无密钥服务可留空"
                }
                autoComplete="new-password"
              />
              <span className="field-hint">
                密钥仅保存在本机后端配置文件，不进入浏览器存储、数据备份或
                GitHub。
              </span>
            </label>
            {settings.hasApiKey && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={(event) => {
                    setClearApiKey(event.target.checked);
                    if (event.target.checked) setApiKey("");
                  }}
                />
                清除已保存的密钥
              </label>
            )}
            <div className="settings-disclosure">
              生成反馈时，会将本次课程信息、年级、当前学生的简短记录，以及本模块已保存的风格参考发送给你配置的服务。程序不主动附带姓名、学校、电话或家长信息；请避免在记录或范文中填写这些信息。
            </div>
            {message && (
              <p className="settings-success" role="status">
                {message}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={busy || !baseUrl.trim() || !model.trim()}
                onClick={() => void save(true)}
              >
                <PlugZap size={16} />
                保存并测试连接
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={busy}
              >
                {busy && <LoaderCircle size={16} className="spin" />}{" "}
                {busy ? "处理中…" : "保存配置"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <p className="field-hint">
        连接测试只发送一句测试文字，可能产生少量模型费用。尚未配置服务时，不会调用外部
        AI。
      </p>
    </Modal>
  );
}
