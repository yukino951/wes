"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAdminEditMode } from './AdminEditMode';

// 【引入你的独立工具模块】
import CalculatorTool from './toolbox/CalculatorTool';
// import TomatoClock from './toolbox/TomatoClock'; // 未来扩展预留

// 【核心架构：插件注册表】
// 以后加新工具，只需要往这个数组里添加对象即可，完全解耦！
const TOOL_REGISTRY = [
  { id: 'calc', name: '计算器', icon: '🧮', component: <CalculatorTool /> },
  // { id: 'tomato', name: '番茄钟', icon: '🍅', component: <TomatoClock /> },
];

export default function GlobalToolbox() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const { editMode, starting, startEditing } = useAdminEditMode();

  // 获取当前激活的工具对象
  const activeTool = TOOL_REGISTRY.find(t => t.id === activeToolId);
  const handleAdminClick = () => {
    void startEditing();
  };

  return (
    <div className="fixed bottom-6 left-6 z-[9999] flex flex-col items-start gap-3">

      {/* 展开的面板区域 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9, transformOrigin: "bottom left" }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ duration: 0.3, type: "spring", stiffness: 300, damping: 25 }}
            className="mb-2 bg-white/70 dark:bg-slate-800/80 backdrop-blur-2xl border border-white/50 dark:border-white/10 shadow-2xl rounded-3xl p-4 w-64 flex flex-col gap-4 overflow-hidden"
          >
            {/* 动态渲染：工具箱导航栏 */}
            <div className="flex flex-wrap gap-2 border-b border-slate-300/50 dark:border-slate-700/50 pb-3">
              {TOOL_REGISTRY.map(tool => (
                <button
                  key={tool.id}
                  onClick={() => setActiveToolId(activeToolId === tool.id ? null : tool.id)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${activeToolId === tool.id ? 'bg-indigo-500 text-white shadow-md' : 'bg-white/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                >
                  {tool.icon} {tool.name}
                </button>
              ))}
            </div>

            {/* 动态渲染：激活的工具组件 */}
            <AnimatePresence mode="wait">
              {activeTool ? (
                // 直接渲染注册表里绑定的独立组件
                <div key={activeTool.id}>
                  {activeTool.component}
                </div>
              ) : (
                // 空状态提醒
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="h-48 flex flex-col items-center justify-center text-slate-400 text-xs font-serif text-center px-4"
                >
                  <svg className="w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 00-1-1H4a1 1 0 01-1-1V4a1 1 0 011-1h3a1 1 0 001-1v-1z" /></svg>
                  点击上方模块<br/>激活工具
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 管理入口与普通工具分开，避免把内容后台伪装成小工具。 */}
      <div className="flex items-center gap-2">
        {!editMode ? (
          <button
            type="button"
            onClick={handleAdminClick}
            disabled={starting}
            title="进入管理员编辑工作区"
            className="group flex h-12 items-center gap-2 rounded-full border border-indigo-300/30 bg-slate-950/85 px-3 text-white shadow-xl backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-indigo-500/25 text-sm">🛡️</span>
            <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-black opacity-0 transition-all duration-300 group-hover:max-w-24 group-hover:opacity-100">
              {starting ? '正在验证…' : '进入编辑'}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          aria-label={isOpen ? '关闭工具箱' : '打开工具箱'}
          onClick={() => { setIsOpen(!isOpen); if (!isOpen && !activeToolId) setActiveToolId(TOOL_REGISTRY[0].id); }}
          className={`z-50 flex h-12 w-12 items-center justify-center rounded-full border border-white/40 shadow-xl backdrop-blur-xl transition-all duration-500 hover:scale-110 active:scale-95 dark:border-white/10
            ${isOpen ? 'rotate-45 bg-indigo-500 text-white' : 'bg-white/70 text-slate-700 dark:bg-slate-800/80 dark:text-white'}
          `}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isOpen ? "M12 4v16m8-8H4" : "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"} />
          </svg>
        </button>
      </div>

    </div>
  );
}
