import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  Check,
  ChevronRight,
  Copy,
  Brain,
  Terminal,
  FileText,
  Pencil,
  Search,
  Globe,
  LoaderCircle,
  X,
  CircleAlert,
  ShieldCheck,
  CheckCheck,
  CornerDownLeft,
} from 'lucide-react';
import type {
  MessageBlock,
  ChatMessage,
  PermissionRequest,
  PermissionAnswer,
} from '../shared/types';

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M24 9.5A11 11 0 1 0 24 22.5M9 16h15M16 9v14"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function IconButton({
  label,
  children,
  onClick,
  className = '',
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`icon-button ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>('input,textarea,button');
    first?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? '已复制' : '复制'}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </IconButton>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href) void window.desktop.openExternal(href).catch(() => {});
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <div className="code-frame">
              <pre>{children}</pre>
            </div>
          ),
          code: ({ className, children, ...props }) => {
            const language = /language-(\S+)/.exec(className || '')?.[1];
            return (
              <>
                {language && <span className="code-language">{language}</span>}
                <code className={className} {...props}>
                  {children}
                </code>
              </>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const toolIcon = (name: string) =>
  /Bash|PowerShell|Shell/i.test(name)
    ? Terminal
    : /Edit|Write|Patch/i.test(name)
      ? Pencil
      : /Read/i.test(name)
        ? FileText
        : /Search|Glob|Grep/i.test(name)
          ? Search
          : /Web|Fetch/i.test(name)
            ? Globe
            : Terminal;
const toolLabel = (name: string) =>
  ({
    Read: '读取文件',
    Edit: '修改文件',
    Write: '写入文件',
    Bash: '执行命令',
    PowerShell: '执行命令',
    Glob: '查找文件',
    Grep: '搜索内容',
    WebSearch: '搜索网页',
    WebFetch: '读取网页',
    Agent: '运行子任务',
    TodoWrite: '更新任务',
    AskUserQuestion: '询问你',
    ExitPlanMode: '提交计划',
  })[name] || name;

function ToolBlock({ block }: { block: Extract<MessageBlock, { type: 'tool' }> }) {
  const Icon = toolIcon(block.name);
  const detail = String(
    block.input.file_path ||
      block.input.path ||
      block.input.command ||
      block.input.pattern ||
      block.input.query ||
      block.input.description ||
      '',
  );
  const oldText = typeof block.input.old_string === 'string' ? block.input.old_string : null;
  const newText =
    typeof block.input.new_string === 'string'
      ? block.input.new_string
      : typeof block.input.content === 'string'
        ? block.input.content
        : null;
  return (
    <details className={`tool-block ${block.state}`}>
      <summary>
        <span className="disclosure">
          <ChevronRight size={13} />
        </span>
        <Icon size={15} />
        <span className="tool-label">{toolLabel(block.name)}</span>
        <span className="tool-detail">{detail}</span>
        <span className="tool-state">
          {block.state === 'running' ? (
            <LoaderCircle size={13} className="spin" />
          ) : block.state === 'error' ? (
            <CircleAlert size={13} />
          ) : block.state === 'interrupted' ? (
            '已停止'
          ) : (
            <Check size={13} />
          )}
        </span>
      </summary>
      <div className="tool-body">
        {newText !== null ? (
          <div className="diff-preview">
            {oldText !== null &&
              oldText.split('\n').map((line, i) => (
                <div className="diff-line removed" key={`o${i}`}>
                  <span>−</span>
                  <code>{line || ' '}</code>
                </div>
              ))}
            {newText.split('\n').map((line, i) => (
              <div className="diff-line added" key={`n${i}`}>
                <span>+</span>
                <code>{line || ' '}</code>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="tool-caption">
              输入 <CopyButton text={JSON.stringify(block.input, null, 2)} />
            </div>
            <pre>{JSON.stringify(block.input, null, 2)}</pre>
          </>
        )}
        {block.output !== undefined && (
          <>
            <div className="tool-caption">
              结果 <CopyButton text={block.output} />
            </div>
            <pre className="tool-output">{block.output || '操作已完成'}</pre>
          </>
        )}
      </div>
    </details>
  );
}

export function Message({ message, live }: { message: ChatMessage; live: boolean }) {
  const plain = message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  if (message.role === 'user')
    return (
      <article className="message user-message">
        <div className="user-bubble">
          {message.references?.length ? (
            <div className="inline-references">
              {message.references.map((ref) => (
                <span key={ref.sessionId}>
                  <FileText size={12} />
                  {ref.title}
                </span>
              ))}
            </div>
          ) : null}
          <div className="user-text">{plain}</div>
        </div>
      </article>
    );
  return (
    <article className="message assistant-message">
      <div className="assistant-heading">
        <Brand small />
        <span>Claude</span>
        {live && <span className="live-label">正在工作</span>}
      </div>
      <div className="assistant-content">
        {message.blocks.map((block, index) => {
          if (block.type === 'text') return <Markdown key={index} text={block.text} />;
          if (block.type === 'thinking')
            return (
              <details key={index} className="thinking-block">
                <summary>
                  <ChevronRight size={13} className="disclosure" />
                  <Brain size={14} />
                  <span>
                    {block.durationMs !== undefined
                      ? '思考过程'
                      : live
                        ? '正在思考'
                        : '思考过程'}
                  </span>
                  <span className="subtle-label">模型返回</span>
                </summary>
                <div className="thinking-content">
                  <Markdown text={block.text || '等待内容…'} />
                </div>
              </details>
            );
          if (block.type === 'tool') return <ToolBlock key={block.id} block={block} />;
          return (
            <div key={index} className={`notice-block ${block.tone}`}>
              <CircleAlert size={15} />
              <span>{block.text}</span>
            </div>
          );
        })}
        {!live && plain && (
          <div className="message-actions">
            <CopyButton text={plain} />
            <span>
              {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

type Question = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
};

export function PermissionCard({
  request,
  onAnswer,
}: {
  request: PermissionRequest;
  onAnswer: (answer: PermissionAnswer) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const questions =
    request.toolName === 'AskUserQuestion' && Array.isArray(request.input.questions)
      ? (request.input.questions as Question[])
      : null;
  const answer = async (allow: boolean) => {
    setBusy(true);
    try {
      await onAnswer({ id: request.id, allow, answers });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="permission-card">
      <div className="permission-heading">
        <ShieldCheck size={18} />
        <strong>{questions ? 'Claude 想确认一下' : '等待你的授权'}</strong>
        <span>{request.toolName}</span>
      </div>
      {questions ? (
        questions.map((question) => (
          <div className="question" key={question.question}>
            <p>{question.question}</p>
            <div className="question-options">
              {question.options?.map((option) => {
                const selected = question.multiSelect
                  ? (answers[question.question] || '').split(', ').includes(option.label)
                  : answers[question.question] === option.label;
                return (
                  <button
                    key={option.label}
                    className={selected ? 'selected' : ''}
                    onClick={() =>
                      setAnswers((previous) => {
                        const values = (previous[question.question] || '')
                          .split(', ')
                          .filter(Boolean);
                        return {
                          ...previous,
                          [question.question]: question.multiSelect
                            ? (selected
                                ? values.filter((value) => value !== option.label)
                                : [...values, option.label]
                              ).join(', ')
                            : option.label,
                        };
                      })
                    }
                  >
                    <span>
                      {selected && <Check size={13} />}
                      {option.label}
                    </span>
                    {option.description && <small>{option.description}</small>}
                  </button>
                );
              })}
            </div>
            <input
              value={answers[question.question] || ''}
              onChange={(event) =>
                setAnswers((previous) => ({ ...previous, [question.question]: event.target.value }))
              }
              placeholder="也可以直接输入你的回答"
              aria-label={question.question}
            />
          </div>
        ))
      ) : (
        <>
          {request.explanation && <p className="permission-explanation">{request.explanation}</p>}
          <pre>{JSON.stringify(request.input, null, 2)}</pre>
          {request.blockedPath && <p className="muted">路径：{request.blockedPath}</p>}
        </>
      )}
      <div className="permission-actions">
        <button className="button secondary" disabled={busy} onClick={() => void answer(false)}>
          拒绝
        </button>
        <button
          className="button primary"
          disabled={
            busy || Boolean(questions?.some((question) => !answers[question.question]?.trim()))
          }
          onClick={() => void answer(true)}
        >
          {busy ? (
            <LoaderCircle className="spin" size={15} />
          ) : questions ? (
            <CornerDownLeft size={15} />
          ) : (
            <CheckCheck size={15} />
          )}
          {questions ? '提交回答' : '允许这一次'}
        </button>
      </div>
    </section>
  );
}
