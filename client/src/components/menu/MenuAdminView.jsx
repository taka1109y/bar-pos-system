import { useState } from 'react';
import { Toolbar, Tabs } from '../ui';
import MenuManager from './MenuManager';
import CategoryManager from './CategoryManager';

// 商品管理ビュー = 商品(MenuManager) + カテゴリ(CategoryManager) をタブで統合。
// ページ枠(ui-pad/タイトル/タブ)は本コンポーネントが供給し、各タブは本体のみ描画する。
export default function MenuAdminView() {
  const [tab, setTab] = useState('items');
  return (
    <div className="ui-pad p-4 md:p-6 space-y-4">
      <Toolbar title="商品管理" subtitle="メニュー商品とカテゴリの管理" />
      <Tabs
        tabs={[{ id: 'items', label: '商品' }, { id: 'categories', label: 'カテゴリ' }]}
        activeId={tab}
        onChange={setTab}
      />
      {tab === 'items' && <MenuManager />}
      {tab === 'categories' && <CategoryManager />}
    </div>
  );
}
