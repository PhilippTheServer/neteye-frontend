import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export enum LogLevel {
  DEBUG = 0,
  INFO  = 1,
  WARN  = 2,
  ERROR = 3,
}

@Injectable({ providedIn: 'root' })
export class LogService {
  private readonly minLevel: LogLevel = environment.production
    ? LogLevel.INFO
    : LogLevel.DEBUG;

  debug(component: string, message: string, context?: object): void {
    this.emit(LogLevel.DEBUG, component, message, context);
  }

  info(component: string, message: string, context?: object): void {
    this.emit(LogLevel.INFO, component, message, context);
  }

  warn(component: string, message: string, context?: object): void {
    this.emit(LogLevel.WARN, component, message, context);
  }

  error(component: string, message: string, context?: object): void {
    this.emit(LogLevel.ERROR, component, message, context);
  }

  private emit(level: LogLevel, component: string, message: string, context?: object): void {
    if (level < this.minLevel) return;

    const ts = new Date().toISOString();
    const label = LogLevel[level].padEnd(5);
    const prefix = `[${ts}] ${label} [${component}]`;
    const args: unknown[] = context !== undefined
      ? [`${prefix} ${message}`, context]
      : [`${prefix} ${message}`];

    switch (level) {
      case LogLevel.DEBUG: console.debug(...args); break;
      case LogLevel.INFO:  console.info(...args);  break;
      case LogLevel.WARN:  console.warn(...args);  break;
      case LogLevel.ERROR: console.error(...args); break;
    }
  }
}
