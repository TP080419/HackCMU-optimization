import {
  INSTRUCTION_BUDGET_PER_TICK,
  LOOP_BUDGET,
  MAX_CALL_DEPTH,
} from './config'
import type {
  CompiledFunction,
  CompiledInstruction,
  CompiledProgram,
  Expression,
  ItemId,
  ProgramAst,
  ProgramDiagnostic,
  ProgramFrame,
  ProgramRuntime,
  ProgramStatement,
  ProgramValue,
} from './types'

interface SourceLine {
  indent: number
  text: string
  line: number
}

interface Token {
  kind: 'number' | 'string' | 'name' | 'operator' | 'punctuation' | 'eof'
  value: string
  column: number
}

export interface ProgramActionRequest {
  name: 'move_to' | 'harvest' | 'plant' | 'load' | 'unload' | 'wait'
  args: ProgramValue[]
  line: number
}

export interface ProgramWorldContext {
  readSensor(name: string, args: ProgramValue[], line: number): ProgramValue
  createAction(name: string, args: ProgramValue[], line: number): ProgramActionRequest | null
}

const ACTION_NAMES = new Set(['move_to', 'harvest', 'plant', 'load', 'unload', 'wait'])

export function isItemId(value: ProgramValue): value is ItemId {
  return typeof value === 'string' && ['xenograin', 'water', 'crystite', 'gel', 'biofiber', 'core'].includes(value)
}

function stripComment(input: string) {
  let quote = ''
  let escaped = false
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    if (char === '#') return input.slice(0, i)
  }
  return input
}

function sourceLines(source: string, diagnostics: ProgramDiagnostic[]) {
  const lines: SourceLine[] = []
  source.replace(/\r\n/g, '\n').split('\n').forEach((raw, index) => {
    if (raw.includes('\t')) {
      diagnostics.push({ line: index + 1, column: raw.indexOf('\t') + 1, message: '请使用 4 个空格缩进，不能使用 Tab。', severity: 'error' })
    }
    const expanded = raw.replace(/\t/g, '    ')
    const clean = stripComment(expanded).replace(/\s+$/, '')
    if (!clean.trim()) return
    const indent = clean.length - clean.trimStart().length
    if (indent % 4 !== 0) {
      diagnostics.push({ line: index + 1, column: 1, message: '缩进必须是 4 的倍数。', severity: 'error' })
    }
    lines.push({ indent, text: clean.trim(), line: index + 1 })
  })
  return lines
}

class ExpressionLexer {
  private index = 0
  constructor(private readonly source: string, private readonly line: number) {}

  tokenize(): Token[] {
    const tokens: Token[] = []
    while (this.index < this.source.length) {
      const start = this.index
      const char = this.source[this.index]
      if (/\s/.test(char)) {
        this.index += 1
        continue
      }
      if (/\d/.test(char)) {
        this.index += 1
        while (/[\d.]/.test(this.source[this.index] ?? '')) this.index += 1
        const value = this.source.slice(start, this.index)
        if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`第 ${this.line} 行：无效数字 ${value}`)
        tokens.push({ kind: 'number', value, column: start + 1 })
        continue
      }
      if (/[A-Za-z_]/.test(char)) {
        this.index += 1
        while (/[A-Za-z0-9_]/.test(this.source[this.index] ?? '')) this.index += 1
        const value = this.source.slice(start, this.index)
        tokens.push({ kind: value === 'and' || value === 'or' || value === 'not' ? 'operator' : 'name', value, column: start + 1 })
        continue
      }
      if (char === '"' || char === "'") {
        const quote = char
        this.index += 1
        let value = ''
        let closed = false
        while (this.index < this.source.length) {
          const current = this.source[this.index]
          if (current === quote) {
            closed = true
            this.index += 1
            break
          }
          if (current === '\\') {
            const escaped = this.source[this.index + 1]
            const mapped: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" }
            value += mapped[escaped] ?? escaped
            this.index += 2
          } else {
            value += current
            this.index += 1
          }
        }
        if (!closed) throw new Error(`第 ${this.line} 行：字符串缺少结束引号。`)
        tokens.push({ kind: 'string', value, column: start + 1 })
        continue
      }
      const pair = this.source.slice(this.index, this.index + 2)
      if (['==', '!=', '<=', '>=', '//'].includes(pair)) {
        tokens.push({ kind: 'operator', value: pair, column: start + 1 })
        this.index += 2
        continue
      }
      if ('+-*/%<>'.includes(char)) {
        tokens.push({ kind: 'operator', value: char, column: start + 1 })
        this.index += 1
        continue
      }
      if ('(),'.includes(char)) {
        tokens.push({ kind: 'punctuation', value: char, column: start + 1 })
        this.index += 1
        continue
      }
      if (char === '.') throw new Error(`第 ${this.line} 行：不允许对象属性访问。`)
      throw new Error(`第 ${this.line} 行：无法识别字符 “${char}”。`)
    }
    tokens.push({ kind: 'eof', value: '', column: this.source.length + 1 })
    return tokens
  }
}

const PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  '==': 3,
  '!=': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '//': 5,
  '%': 5,
}

class ExpressionParser {
  private cursor = 0
  constructor(private readonly tokens: Token[], private readonly line: number) {}

  parse() {
    const expression = this.parsePrecedence(0)
    if (this.peek().kind !== 'eof') throw new Error(`第 ${this.line} 行：表达式末尾存在多余内容。`)
    return expression
  }

  private peek() {
    return this.tokens[this.cursor]
  }

  private consume() {
    const token = this.tokens[this.cursor]
    this.cursor += 1
    return token
  }

  private parsePrecedence(minimum: number): Expression {
    let left = this.parsePrefix()
    while (this.peek().kind === 'operator') {
      const operator = this.peek().value
      const precedence = PRECEDENCE[operator]
      if (precedence === undefined || precedence < minimum) break
      this.consume()
      const right = this.parsePrecedence(precedence + 1)
      left = { kind: 'binary', operator: operator as Extract<Expression, { kind: 'binary' }>['operator'], left, right, line: this.line }
    }
    return left
  }

  private parsePrefix(): Expression {
    const token = this.consume()
    if (token.kind === 'operator' && ['-', '+', 'not'].includes(token.value)) {
      return { kind: 'unary', operator: token.value as '-' | '+' | 'not', operand: this.parsePrecedence(6), line: this.line }
    }
    if (token.kind === 'number') return { kind: 'literal', value: Number(token.value), line: this.line }
    if (token.kind === 'string') return { kind: 'literal', value: token.value, line: this.line }
    if (token.kind === 'name') {
      if (token.value === 'True') return { kind: 'literal', value: true, line: this.line }
      if (token.value === 'False') return { kind: 'literal', value: false, line: this.line }
      if (token.value === 'None') return { kind: 'literal', value: null, line: this.line }
      if (this.peek().value === '(') {
        this.consume()
        const args: Expression[] = []
        if (this.peek().value !== ')') {
          while (true) {
            args.push(this.parsePrecedence(0))
            if (this.peek().value !== ',') break
            this.consume()
          }
        }
        if (this.consume().value !== ')') throw new Error(`第 ${this.line} 行：函数调用缺少右括号。`)
        return { kind: 'call', callee: token.value, args, line: this.line }
      }
      return { kind: 'name', name: token.value, line: this.line }
    }
    if (token.value === '(') {
      const expression = this.parsePrecedence(0)
      if (this.consume().value !== ')') throw new Error(`第 ${this.line} 行：表达式缺少右括号。`)
      return expression
    }
    throw new Error(`第 ${this.line} 行：表达式不完整。`)
  }
}

function parseExpression(source: string, line: number) {
  return new ExpressionParser(new ExpressionLexer(source, line).tokenize(), line).parse()
}

function assignmentIndex(text: string) {
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === '=' && depth === 0 && text[i - 1] !== '<' && text[i - 1] !== '>' && text[i - 1] !== '!' && text[i - 1] !== '=' && text[i + 1] !== '=') return i
  }
  return -1
}

class StatementParser {
  private readonly diagnostics: ProgramDiagnostic[] = []
  private readonly lines: SourceLine[]
  private cursor = 0

  constructor(private readonly source: string) {
    this.lines = sourceLines(source, this.diagnostics)
  }

  parse(): ProgramAst {
    const body = this.parseBlock(0)
    return { source: this.source, body, diagnostics: this.diagnostics }
  }

  private error(line: number, message: string) {
    this.diagnostics.push({ line, column: 1, message, severity: 'error' })
  }

  private expression(source: string, line: number) {
    try {
      return parseExpression(source, line)
    } catch (error) {
      this.error(line, error instanceof Error ? error.message : String(error))
      return { kind: 'literal', value: null, line } as Expression
    }
  }

  private parseBlock(indent: number): ProgramStatement[] {
    const body: ProgramStatement[] = []
    while (this.cursor < this.lines.length) {
      const line = this.lines[this.cursor]
      if (line.indent < indent) break
      if (line.indent > indent) {
        this.error(line.line, '出现了没有对应代码块的额外缩进。')
        this.cursor += 1
        continue
      }
      if (/^(elif\b|else\s*:)/.test(line.text)) break
      const statement = this.parseStatement(indent)
      if (statement) body.push(statement)
    }
    return body
  }

  private parseStatement(indent: number): ProgramStatement | null {
    const line = this.lines[this.cursor]
    const text = line.text
    const forbidden = /^(import|from|class|async|await|with|try|raise|yield|global|nonlocal|del)\b/.exec(text)
    if (forbidden) {
      this.error(line.line, `安全运行时不支持 ${forbidden[1]}。`)
      this.cursor += 1
      return null
    }
    if (text.startsWith('if ') && text.endsWith(':')) return this.parseIf(indent)
    if (text.startsWith('while ') && text.endsWith(':')) {
      this.cursor += 1
      const condition = this.expression(text.slice(6, -1).trim(), line.line)
      const body = this.parseBlock(indent + 4)
      if (!body.length) this.error(line.line, 'while 代码块不能为空。')
      return { kind: 'while', condition, body, line: line.line }
    }
    if (text.startsWith('for ') && text.endsWith(':')) {
      const match = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/.exec(text)
      this.cursor += 1
      if (!match) {
        this.error(line.line, 'for 语法应为：for item in iterable():')
        return null
      }
      const body = this.parseBlock(indent + 4)
      if (!body.length) this.error(line.line, 'for 代码块不能为空。')
      return { kind: 'for', name: match[1], iterable: this.expression(match[2], line.line), body, line: line.line }
    }
    if (text.startsWith('def ') && text.endsWith(':')) {
      const match = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:$/.exec(text)
      this.cursor += 1
      if (!match) {
        this.error(line.line, '函数语法应为：def name(arg):')
        return null
      }
      const params = match[2].trim() ? match[2].split(',').map((value) => value.trim()) : []
      if (params.some((param) => !/^[A-Za-z_]\w*$/.test(param))) this.error(line.line, '函数参数必须是简单名称。')
      const body = this.parseBlock(indent + 4)
      if (!body.length) this.error(line.line, '函数体不能为空。')
      return { kind: 'function', name: match[1], params, body, line: line.line }
    }
    if (text === 'return' || text.startsWith('return ')) {
      this.cursor += 1
      return { kind: 'return', value: text === 'return' ? null : this.expression(text.slice(7), line.line), line: line.line }
    }
    if (text === 'pass') {
      this.cursor += 1
      return { kind: 'expression', expression: { kind: 'literal', value: null, line: line.line }, line: line.line }
    }
    const equals = assignmentIndex(text)
    this.cursor += 1
    if (equals >= 0) {
      const name = text.slice(0, equals).trim()
      if (!/^[A-Za-z_]\w*$/.test(name)) {
        this.error(line.line, '赋值左侧必须是简单变量名。')
        return null
      }
      return { kind: 'assign', name, value: this.expression(text.slice(equals + 1).trim(), line.line), line: line.line }
    }
    return { kind: 'expression', expression: this.expression(text, line.line), line: line.line }
  }

  private parseIf(indent: number): ProgramStatement {
    const start = this.lines[this.cursor]
    const branches: Array<{ condition: Expression; body: ProgramStatement[] }> = []
    let current = start
    while (current && current.indent === indent && (current.text.startsWith('if ') || current.text.startsWith('elif '))) {
      const prefix = current.text.startsWith('if ') ? 3 : 5
      this.cursor += 1
      branches.push({ condition: this.expression(current.text.slice(prefix, -1).trim(), current.line), body: this.parseBlock(indent + 4) })
      current = this.lines[this.cursor]
    }
    let elseBody: ProgramStatement[] = []
    if (current?.indent === indent && current.text === 'else:') {
      this.cursor += 1
      elseBody = this.parseBlock(indent + 4)
    }
    if (branches.some((branch) => !branch.body.length)) this.error(start.line, 'if/elif 代码块不能为空。')
    return { kind: 'if', branches, elseBody, line: start.line }
  }
}

export function parseProgram(source: string) {
  return new StatementParser(source).parse()
}

function compileStatements(
  statements: ProgramStatement[],
  functions: Record<string, CompiledFunction>,
  counter: { value: number },
) {
  const output: CompiledInstruction[] = []
  const compile = (items: ProgramStatement[]) => {
    for (const statement of items) {
      if (statement.kind === 'function') continue
      if (statement.kind === 'assign') {
        if (statement.value.kind === 'call' && functions[statement.value.callee]) {
          output.push({ op: 'callUser', name: statement.value.callee, args: statement.value.args, assignTo: statement.name, line: statement.line })
        } else output.push({ op: 'assign', name: statement.name, value: statement.value, line: statement.line })
      } else if (statement.kind === 'expression') {
        if (statement.expression.kind === 'call' && functions[statement.expression.callee]) {
          output.push({ op: 'callUser', name: statement.expression.callee, args: statement.expression.args, line: statement.line })
        } else output.push({ op: 'expression', expression: statement.expression, line: statement.line })
      } else if (statement.kind === 'if') {
        const endJumps: number[] = []
        for (const branch of statement.branches) {
          const conditionIndex = output.length
          output.push({ op: 'jumpIfFalse', condition: branch.condition, target: -1, line: statement.line })
          compile(branch.body)
          endJumps.push(output.length)
          output.push({ op: 'jump', target: -1, line: statement.line })
          ;(output[conditionIndex] as Extract<CompiledInstruction, { op: 'jumpIfFalse' }>).target = output.length
        }
        compile(statement.elseBody)
        for (const index of endJumps) (output[index] as Extract<CompiledInstruction, { op: 'jump' }>).target = output.length
      } else if (statement.kind === 'while') {
        const start = output.length
        const conditionIndex = output.length
        output.push({ op: 'jumpIfFalse', condition: statement.condition, target: -1, line: statement.line })
        compile(statement.body)
        output.push({ op: 'jump', target: start, line: statement.line })
        ;(output[conditionIndex] as Extract<CompiledInstruction, { op: 'jumpIfFalse' }>).target = output.length
      } else if (statement.kind === 'for') {
        const loopId = `loop-${counter.value++}`
        const initIndex = output.length
        output.push({ op: 'forInit', loopId, name: statement.name, iterable: statement.iterable, exit: -1, line: statement.line })
        const bodyStart = output.length
        compile(statement.body)
        const nextIndex = output.length
        output.push({ op: 'forNext', loopId, name: statement.name, body: bodyStart, exit: nextIndex + 1, line: statement.line })
        ;(output[initIndex] as Extract<CompiledInstruction, { op: 'forInit' }>).exit = output.length
      } else if (statement.kind === 'return') {
        output.push({ op: 'return', value: statement.value, line: statement.line })
      }
    }
  }
  compile(statements)
  return output
}

export function compileProgram(ast: ProgramAst): CompiledProgram {
  const functions: Record<string, CompiledFunction> = {}
  for (const statement of ast.body) {
    if (statement.kind === 'function') functions[statement.name] = { name: statement.name, params: statement.params, instructions: [], line: statement.line }
  }
  const counter = { value: 0 }
  for (const statement of ast.body) {
    if (statement.kind !== 'function') continue
    functions[statement.name].instructions = [
      ...compileStatements(statement.body, functions, counter),
      { op: 'return', value: null, line: statement.line },
    ]
  }
  const main = [...compileStatements(ast.body, functions, counter), { op: 'halt', line: Math.max(1, ast.source.split('\n').length) }] as CompiledInstruction[]
  return { main, functions }
}

const DEFAULT_GLOBALS: Record<string, ProgramValue> = {
  True: true,
  False: false,
  None: null,
  XENOGRAIN: 'xenograin',
  WATER: 'water',
  CRYSTITE: 'crystite',
  GEL: 'gel',
  BIOFIBER: 'biofiber',
  CORE: 'core',
}

export function createProgramRuntime(source: string): ProgramRuntime {
  const ast = parseProgram(source)
  const hasErrors = ast.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  const compiled = hasErrors ? null : compileProgram(ast)
  return {
    mode: hasErrors ? 'error' : 'stopped',
    source,
    ast,
    compiled,
    frames: compiled ? [{ functionName: '<main>', pc: 0, locals: {} }] : [],
    globals: { ...DEFAULT_GLOBALS },
    loops: {},
    currentLine: null,
    lastSensor: '',
    usedSensors: [],
    lastError: hasErrors ? ast.diagnostics[0]?.message ?? '程序无法解析。' : null,
    pendingAction: false,
    pauseAfterAction: false,
    instructionCount: 0,
    loopIterations: 0,
    lineCosts: {},
  }
}

export function resetProgramRuntime(runtime: ProgramRuntime) {
  return createProgramRuntime(runtime.source)
}

function truthy(value: ProgramValue): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

function asNumber(value: ProgramValue, line: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`第 ${line} 行：这里需要有限数字。`)
  return value
}

function equal(left: ProgramValue, right: ProgramValue) {
  if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right)
  return left === right
}

function lookup(runtime: ProgramRuntime, frame: ProgramFrame, name: string, line: number) {
  if (Object.hasOwn(frame.locals, name)) return frame.locals[name]
  if (Object.hasOwn(runtime.globals, name)) return runtime.globals[name]
  throw new Error(`第 ${line} 行：变量 ${name} 尚未定义。`)
}

function evalExpression(expression: Expression, runtime: ProgramRuntime, frame: ProgramFrame, context: ProgramWorldContext): ProgramValue {
  if (expression.kind === 'literal') return expression.value
  if (expression.kind === 'name') return lookup(runtime, frame, expression.name, expression.line)
  if (expression.kind === 'unary') {
    const value = evalExpression(expression.operand, runtime, frame, context)
    if (expression.operator === 'not') return !truthy(value)
    return expression.operator === '-' ? -asNumber(value, expression.line) : asNumber(value, expression.line)
  }
  if (expression.kind === 'binary') {
    const left = evalExpression(expression.left, runtime, frame, context)
    if (expression.operator === 'and') return truthy(left) ? evalExpression(expression.right, runtime, frame, context) : left
    if (expression.operator === 'or') return truthy(left) ? left : evalExpression(expression.right, runtime, frame, context)
    const right = evalExpression(expression.right, runtime, frame, context)
    if (expression.operator === '==') return equal(left, right)
    if (expression.operator === '!=') return !equal(left, right)
    if (expression.operator === '+') {
      if (typeof left === 'string' && typeof right === 'string') return left + right
      return asNumber(left, expression.line) + asNumber(right, expression.line)
    }
    if (expression.operator === '-') return asNumber(left, expression.line) - asNumber(right, expression.line)
    if (expression.operator === '*') return asNumber(left, expression.line) * asNumber(right, expression.line)
    if (expression.operator === '/') return asNumber(left, expression.line) / asNumber(right, expression.line)
    if (expression.operator === '//') return Math.floor(asNumber(left, expression.line) / asNumber(right, expression.line))
    if (expression.operator === '%') return asNumber(left, expression.line) % asNumber(right, expression.line)
    if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) throw new Error(`第 ${expression.line} 行：无法比较这两个值。`)
    if (typeof left === 'number') {
      const comparable = right as number
      if (expression.operator === '<') return left < comparable
      if (expression.operator === '<=') return left <= comparable
      if (expression.operator === '>') return left > comparable
      return left >= comparable
    }
    const comparable = right as string
    if (expression.operator === '<') return left < comparable
    if (expression.operator === '<=') return left <= comparable
    if (expression.operator === '>') return left > comparable
    return left >= comparable
  }
  const args = expression.args.map((argument) => evalExpression(argument, runtime, frame, context))
  if (expression.callee === 'range') {
    if (args.length < 1 || args.length > 3) throw new Error(`第 ${expression.line} 行：range 需要 1–3 个参数。`)
    const start = args.length === 1 ? 0 : asNumber(args[0], expression.line)
    const stop = asNumber(args.length === 1 ? args[0] : args[1], expression.line)
    const step = args.length === 3 ? asNumber(args[2], expression.line) : 1
    if (step === 0) throw new Error(`第 ${expression.line} 行：range 步长不能为 0。`)
    const values: ProgramValue[] = []
    for (let value = start; step > 0 ? value < stop : value > stop; value += step) {
      values.push(value)
      if (values.length > LOOP_BUDGET) throw new Error(`第 ${expression.line} 行：range 超出循环预算。`)
    }
    return values
  }
  if (ACTION_NAMES.has(expression.callee)) throw new Error(`第 ${expression.line} 行：世界动作不能嵌套在表达式中。`)
  const value = context.readSensor(expression.callee, args, expression.line)
  runtime.lastSensor = `${expression.callee}(${args.map(String).join(', ')}) → ${String(value)}`
  runtime.usedSensors ??= []
  if (!runtime.usedSensors.includes(expression.callee)) runtime.usedSensors.push(expression.callee)
  return value
}

function instructionsFor(runtime: ProgramRuntime, frame: ProgramFrame) {
  if (!runtime.compiled) return []
  return frame.functionName === '<main>' ? runtime.compiled.main : runtime.compiled.functions[frame.functionName]?.instructions ?? []
}

function failRuntime(runtime: ProgramRuntime, error: unknown) {
  runtime.mode = 'error'
  runtime.pendingAction = false
  runtime.lastError = error instanceof Error ? error.message : String(error)
}

export function resumeProgramAfterAction(runtime: ProgramRuntime) {
  runtime.pendingAction = false
  if (runtime.pauseAfterAction) {
    runtime.pauseAfterAction = false
    runtime.mode = 'paused'
  }
}

export function executeProgram(runtime: ProgramRuntime, context: ProgramWorldContext, budget = INSTRUCTION_BUDGET_PER_TICK): ProgramActionRequest | null {
  if (runtime.mode !== 'running' || runtime.pendingAction || !runtime.compiled) return null
  try {
    for (let spent = 0; spent < budget; spent += 1) {
      const frame = runtime.frames[runtime.frames.length - 1]
      if (!frame) {
        runtime.mode = 'complete'
        return null
      }
      const instructions = instructionsFor(runtime, frame)
      const instruction = instructions[frame.pc]
      if (!instruction) throw new Error(`运行时失去执行位置：${frame.functionName}:${frame.pc}`)
      runtime.currentLine = instruction.line
      runtime.instructionCount += 1
      runtime.lineCosts[String(instruction.line)] = (runtime.lineCosts[String(instruction.line)] ?? 0) + 1
      if (instruction.op === 'assign') {
        frame.locals[instruction.name] = evalExpression(instruction.value, runtime, frame, context)
        frame.pc += 1
      } else if (instruction.op === 'expression') {
        if (instruction.expression.kind === 'call' && ACTION_NAMES.has(instruction.expression.callee)) {
          const args = instruction.expression.args.map((argument) => evalExpression(argument, runtime, frame, context))
          const action = context.createAction(instruction.expression.callee, args, instruction.line)
          frame.pc += 1
          if (action) {
            runtime.pendingAction = true
            return action
          }
        } else {
          evalExpression(instruction.expression, runtime, frame, context)
          frame.pc += 1
        }
      } else if (instruction.op === 'jumpIfFalse') {
        frame.pc = truthy(evalExpression(instruction.condition, runtime, frame, context)) ? frame.pc + 1 : instruction.target
      } else if (instruction.op === 'jump') {
        frame.pc = instruction.target
        runtime.loopIterations += 1
      } else if (instruction.op === 'forInit') {
        const value = evalExpression(instruction.iterable, runtime, frame, context)
        if (!Array.isArray(value)) throw new Error(`第 ${instruction.line} 行：for 右侧必须返回可遍历列表。`)
        runtime.loops[`${runtime.frames.length}:${instruction.loopId}`] = { values: value, index: 0 }
        if (!value.length) frame.pc = instruction.exit
        else {
          frame.locals[instruction.name] = value[0]
          frame.pc += 1
        }
      } else if (instruction.op === 'forNext') {
        const key = `${runtime.frames.length}:${instruction.loopId}`
        const loop = runtime.loops[key]
        if (!loop) throw new Error(`第 ${instruction.line} 行：循环状态已丢失。`)
        loop.index += 1
        runtime.loopIterations += 1
        if (loop.index < loop.values.length) {
          frame.locals[instruction.name] = loop.values[loop.index]
          frame.pc = instruction.body
        } else {
          delete runtime.loops[key]
          frame.pc = instruction.exit
        }
      } else if (instruction.op === 'callUser') {
        const fn = runtime.compiled.functions[instruction.name]
        if (!fn) throw new Error(`第 ${instruction.line} 行：函数 ${instruction.name} 不存在。`)
        if (runtime.frames.length >= MAX_CALL_DEPTH) throw new Error(`第 ${instruction.line} 行：函数调用深度超过 ${MAX_CALL_DEPTH}。`)
        if (runtime.frames.some((entry) => entry.functionName === instruction.name)) throw new Error(`第 ${instruction.line} 行：不允许递归调用 ${instruction.name}。`)
        const args = instruction.args.map((argument) => evalExpression(argument, runtime, frame, context))
        if (args.length !== fn.params.length) throw new Error(`第 ${instruction.line} 行：${instruction.name} 需要 ${fn.params.length} 个参数。`)
        frame.pc += 1
        const locals: Record<string, ProgramValue> = {}
        fn.params.forEach((param, index) => { locals[param] = args[index] })
        runtime.frames.push({ functionName: fn.name, pc: 0, locals, returnTarget: instruction.assignTo })
      } else if (instruction.op === 'return') {
        const value = instruction.value ? evalExpression(instruction.value, runtime, frame, context) : null
        const finished = runtime.frames.pop()
        const caller = runtime.frames[runtime.frames.length - 1]
        if (finished?.returnTarget && caller) caller.locals[finished.returnTarget] = value
        if (!caller) runtime.mode = 'complete'
      } else {
        runtime.mode = 'complete'
        runtime.currentLine = null
        return null
      }
      if (runtime.loopIterations > LOOP_BUDGET) throw new Error(`循环预算超过 ${LOOP_BUDGET}；请让程序执行世界动作或缩小循环。`)
    }
    throw new Error(`单个模拟 tick 超过 ${budget} 条指令；程序可能陷入没有世界动作的死循环。`)
  } catch (error) {
    failRuntime(runtime, error)
    return null
  }
}
