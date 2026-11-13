// 공식 SDK(index.js)용 타입 선언. 이 프로젝트가 쓰는 범위만 적는다.
import type { EventEmitter } from 'node:events';

export interface ContextParts {
  uuid: string;
  key: string;
  actionid: string;
}

/** Studio가 보내는 키 단위 메시지. SDK가 context를 덧붙여 넘긴다. */
export interface ActionMessage extends ContextParts {
  cmd: string;
  context: string;
  param?: Record<string, unknown> | null;
}

export interface SetActiveMessage extends ActionMessage {
  active: boolean;
}

export interface DialRotateMessage extends ActionMessage {
  rotateEvent: 'left' | 'right' | 'hold-left' | 'hold-right';
}

export interface ClearMessage {
  cmd: 'clear';
  param?: Array<ContextParts & { context: string }> | null;
}

export type LogLevel = 'info' | 'debug' | 'warn' | 'error';

export class UlanziApi extends EventEmitter {
  language: string;
  connect(uuid: string, port?: number, address?: string): void;
  encodeContext(parts: ContextParts): string;
  decodeContext(context: string): ContextParts;

  onConnected(fn: () => void): this;
  onClose(fn: () => void): this;
  onError(fn: (error: string) => void): this;
  onAdd(fn: (message: ActionMessage) => void): this;
  onRun(fn: (message: ActionMessage) => void): this;
  onKeyDown(fn: (message: ActionMessage) => void): this;
  onKeyUp(fn: (message: ActionMessage) => void): this;
  onSetActive(fn: (message: SetActiveMessage) => void): this;
  onClear(fn: (message: ClearMessage) => void): this;
  onParamFromApp(fn: (message: ActionMessage) => void): this;
  onParamFromPlugin(fn: (message: ActionMessage) => void): this;
  onDidReceiveSettings(fn: (message: ActionMessage & { settings?: Record<string, unknown> }) => void): this;
  onDialDown(fn: (message: ActionMessage) => void): this;
  onDialUp(fn: (message: ActionMessage) => void): this;
  onDialRotate(fn: (message: DialRotateMessage) => void): this;

  setStateIcon(context: string, state: number, text?: string): void;
  setBaseDataIcon(context: string, data: string, text?: string): void;
  /** 명령을 그대로 보낸다. 여러 키의 아이콘을 한 번에 바꿀 때 'state'와 statelist로 쓴다. */
  send(cmd: string, params: Record<string, unknown>): void;
  setPathIcon(context: string, path: string, text?: string): void;
  setGifDataIcon(context: string, gifdata: string, text?: string): void;
  setFeedback(context: string, layout: Record<string, unknown>): void;
  setFeedbackLayout(context: string, layout: string): void;
  setSettings(settings: Record<string, unknown>, context: string): void;
  getSettings(context: string): void;
  sendParamFromPlugin(settings: Record<string, unknown>, context: string): void;

  toast(msg: string): void;
  showAlert(context: string): void;
  logMessage(msg: string, level?: LogLevel): void;
}

export interface UlanziUtils {
  getPluginPath(): string;
  getSystemType(): 'windows' | 'mac';
  adaptLanguage(ln: string): string;
}

export const Utils: UlanziUtils;
export class RandomPort {
  constructor(minPort?: number, maxPort?: number);
  getPort(): number;
}

export default UlanziApi;
