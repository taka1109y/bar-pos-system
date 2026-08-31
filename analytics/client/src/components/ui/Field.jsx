// 複製元: client/src/components/ui/Field.jsx (本番 client を不変に保つため複製)
import { cn } from './cn';

// フォーム制御のラベル/ヒント/エラーを包む。包含divに leading-normal を付与
// (body の行間リセット。melta のフォーム制御ラベル規約)。
export default function Field({ label, htmlFor, hint, error, required = false, className, children }) {
  return (
    <div className={cn('leading-normal', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-body mb-1">
          {label}{required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
