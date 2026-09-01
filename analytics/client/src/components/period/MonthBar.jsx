import dayjs from 'dayjs';
import { Button, Input } from '../ui';
import { cn } from '../ui/cn';

// 月セレクタ(入力系・月次ページ共通)。前月/翌月ボタン + type=month 入力。
// PeriodBar(期間バー)は分析系ページ用、こちらは月単位で完結するページ用。
export default function MonthBar({ month, onChange, className }) {
  const move = (diff) => onChange(dayjs(`${month}-01`).add(diff, 'month').format('YYYY-MM'));
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Button variant="secondary" size="sm" iconOnly aria-label="前の月" onClick={() => move(-1)}>
        <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Button>
      <Input
        size="sm"
        type="month"
        value={month}
        aria-label="表示する月"
        className="w-36"
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
      <Button variant="secondary" size="sm" iconOnly aria-label="次の月" onClick={() => move(1)}>
        <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Button>
    </div>
  );
}
