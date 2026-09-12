import { useEffect, useRef } from 'react'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { lintGutter, linter } from '@codemirror/lint'
import { python } from '@codemirror/lang-python'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from '@codemirror/view'
import { parseProgram } from '../program'
import type { ProgramRuntime } from '../types'

const setExecutingLine = StateEffect.define<number | null>()
const executingLine = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setExecutingLine)) continue
      const line = effect.value
      if (!line || line > transaction.state.doc.lines) return Decoration.none
      return Decoration.set([Decoration.line({ class: 'cm-executing-line' }).range(transaction.state.doc.line(line).from)])
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

const apiCompletions = [
  ['move_to', 'action', '飞向地块、端点或命名机器'],
  ['harvest', 'action', '收割当前成熟地块并自动回种'],
  ['plant', 'action', '消耗 1 Xenograin 播种当前空地块'],
  ['load', 'action', '从命名端点装载指定物品，可混装 Cargo'],
  ['unload', 'action', '向命名端点卸载指定物品'],
  ['wait', 'action', '等待指定模拟秒数'],
  ['farm_zone', 'sensor', '返回农田内全部地块名称'],
  ['is_ripe', 'sensor', '检测地块是否成熟'],
  ['need', 'sensor', '读取机器与排队缓存的实时需求'],
  ['cargo_free', 'sensor', '返回无人机剩余容量'],
  ['cargo', 'sensor', '返回 Cargo 总量或某物品数量'],
  ['distance_to', 'sensor', '读取到命名目标的格距'],
  ['XENOGRAIN', 'constant', 'Xenograin 物品常量'],
  ['WATER', 'constant', 'Water 物品常量'],
  ['CRYSTITE', 'constant', 'Crystite 物品常量'],
  ['GEL', 'constant', 'Nutrient Gel 物品常量'],
  ['BIOFIBER', 'constant', 'Biofiber 物品常量'],
  ['CORE', 'constant', 'Terraform Core 物品常量'],
] as const

function completionSource(context: CompletionContext) {
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  if (!word && !context.explicit) return null
  return {
    from: word?.from ?? context.pos,
    options: apiCompletions.map(([label, type, info]) => ({ label, type, info })),
  }
}

function diagnostics(view: EditorView) {
  return parseProgram(view.state.doc.toString()).diagnostics.map((diagnostic) => {
    const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, diagnostic.line)))
    return {
      from: Math.min(line.to, line.from + Math.max(0, diagnostic.column - 1)),
      to: Math.max(line.from + 1, line.to),
      severity: diagnostic.severity,
      message: diagnostic.message,
    } as const
  })
}

const theme = EditorView.theme({
  '&': { height: '100%', color: '#e9f4ec', backgroundColor: '#151c19' },
  '.cm-content': { caretColor: '#8ff5dd', fontFamily: '"JetBrains Mono", "Cascadia Code", monospace', fontSize: '14px', lineHeight: '1.75', padding: '16px 0 80px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#8ff5dd' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#31594d' },
  '.cm-gutters': { backgroundColor: '#101613', color: '#60746c', border: 'none', paddingLeft: '6px' },
  '.cm-activeLineGutter': { backgroundColor: '#25312b', color: '#d9eadf' },
  '.cm-activeLine': { backgroundColor: '#26342d73' },
  '.cm-executing-line': { backgroundColor: '#547f4066', boxShadow: 'inset 3px 0 #b8ec6c' },
  '.cm-tooltip': { border: '1px solid #496158', backgroundColor: '#19221e', color: '#e9f4ec' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#35584c', color: '#fff' },
})

interface CodeWorkbenchProps {
  source: string
  runtime: ProgramRuntime
  insertion?: { name: string; nonce: number } | null
  onChange: (source: string) => void
  onRun: () => void
  onPause: () => void
  onStep: () => void
  onReset: () => void
  onClose: () => void
}

export function CodeWorkbench({ source, runtime, insertion, onChange, onRun, onPause, onStep, onReset, onClose }: CodeWorkbenchProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const editor = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: source,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ override: [completionSource], activateOnTyping: true }),
          rectangularSelection(),
          highlightActiveLine(),
          lintGutter(),
          linter(diagnostics, { delay: 180 }),
          executingLine,
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeRef.current(update.state.doc.toString())
          }),
          theme,
        ],
      }),
    })
    editorRef.current = editor
    return () => editor.destroy()
    // The editor owns its document after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.dispatch({ effects: setExecutingLine.of(runtime.currentLine) })
  }, [runtime.currentLine])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const current = editor.state.doc.toString()
    if (current === source) return
    editor.dispatch({ changes: { from: 0, to: current.length, insert: source }, selection: { anchor: 0 }, scrollIntoView: true })
  }, [source])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !insertion) return
    const { from, to } = editor.state.selection.main
    const quoted = `"${insertion.name}"`
    editor.dispatch({ changes: { from, to, insert: quoted }, selection: { anchor: from + quoted.length }, scrollIntoView: true })
    editor.focus()
  }, [insertion])

  const frame = runtime.frames[runtime.frames.length - 1]
  const variables = frame ? Object.entries(frame.locals).slice(0, 8) : []
  return (
    <aside className="code-workbench" aria-label="Drone code workbench">
      <header className="workbench-header">
        <div>
          <span className="eyebrow">DRONE // PY-LITE</span>
          <h2>需求调度程序</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭代码面板">×</button>
      </header>

      <div className="workbench-toolbar">
        <button className="primary-action" type="button" onClick={onRun}>▶ Run</button>
        <button type="button" onClick={onPause}>Ⅱ Pause</button>
        <button type="button" onClick={onStep}>↦ Step action</button>
        <button type="button" onClick={onReset}>↺ Reset</button>
        <span className={`runtime-pill runtime-${runtime.mode}`}>{runtime.mode}</span>
      </div>

      <div className="editor-shell" ref={hostRef} />

      <footer className="runtime-console">
        <div className="runtime-summary">
          <span>LINE <strong>{runtime.currentLine ?? '—'}</strong></span>
          <span>INSTRUCTIONS <strong>{runtime.instructionCount}</strong></span>
          <span>DEPTH <strong>{runtime.frames.length}</strong></span>
        </div>
        {runtime.lastError ? <p className="runtime-error">{runtime.lastError}</p> : (
          <p className="sensor-readout">{runtime.lastSensor || '传感器尚未返回数据。点击世界中的机器可插入其名称。'}</p>
        )}
        {variables.length > 0 && (
          <div className="variable-watch">
            {variables.map(([name, value]) => <span key={name}><b>{name}</b> = {Array.isArray(value) ? `[${value.length}]` : String(value)}</span>)}
          </div>
        )}
      </footer>
    </aside>
  )
}
