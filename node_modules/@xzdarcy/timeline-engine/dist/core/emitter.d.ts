import { Events } from './events';
/**
 * 事件派发器
 */
export declare class Emitter<EventTypes> {
    events: {
        [key: string]: CallableFunction[];
    };
    constructor(events: Events);
    on<K extends keyof EventTypes>(names: K | K[], handler: (args: EventTypes[K]) => boolean | unknown): this;
    trigger<K extends keyof EventTypes>(name: K, params: EventTypes[K]): boolean;
    bind(name: string): void;
    exist(name: string): boolean;
    off<K extends keyof EventTypes>(name: K, handler?: (args: EventTypes[K]) => boolean | unknown): void;
    offAll(): void;
}
