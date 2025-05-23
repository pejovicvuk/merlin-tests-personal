import { indexOfPair, indexOfTriplet, removePair } from "./algorithms.js";

type ChangeListener<TObj extends {}, TTok> = (obj: TObj, token: TTok) => void;

export const addListener: unique symbol = Symbol("addListener");
export const removeListener: unique symbol = Symbol("removeListener");

export interface IChangeTracker<TObj extends {}> {
    [addListener]<TTok>(handler: ChangeListener<TObj, TTok>, key: any, token: TTok): void;
    [removeListener]<TTok>(handler: ChangeListener<TObj, TTok>, key: any, token: TTok): void;
}

type ArrayChangeListener<T> = (arr: T[], index: number, inserted: number, deleted: number, removedItems: T | T[] | undefined) => void;

export const addArrayListener: unique symbol = Symbol("addArrayListener");
export const removeArrayListener: unique symbol = Symbol("removeArrayListener");

export interface IArrayChangeTracker<T> extends IChangeTracker<T[]> {
    [addArrayListener](handler: ArrayChangeListener<T>): void;
    [removeArrayListener](handler: ArrayChangeListener<T>): void;
}

export class DependencyTrackingMetrics {
    static allocatedProxies = 0;
    static proxyListeners = 0;
    static allocatedArrayProxies = 0;
    static arrayProxyListeners = 0;
    static evals = 0;
    static clears = 0;
}

let accessDependencies: undefined | (any[]);
let accessDependenciesExistingStart = 0;
let accessDependenciesExistingEnd = 0;

// accessDependencies starts with a list of pairs (key, tracker) stored pairwise
// into even and odd indices. Initially accessDependenciesExistingStart and accessDependenciesExistingEnd
// are both stored to accessDependencies.length.
//
// Calls to registerAccess will, if the dependency is not stored in accessDependencies, simply add it there,
// while if it does it will move it to accessDependenciesExistingStart - 2 and then decrement accessDependenciesExistingStart
// by two

export function registerAccess<TObj extends {}> (tracker: IChangeTracker<TObj>, key: any): void {
    if (accessDependencies === undefined) return;

    const idx = indexOfPair(accessDependencies, key, tracker);
    if (idx < 0) {
        accessDependencies.push(key, tracker);
    }
    else if (idx < accessDependenciesExistingStart) { // otherwise already handled by previous calls to this function
        accessDependenciesExistingStart -= 2;
        accessDependencies[idx] = accessDependencies[accessDependenciesExistingStart];
        accessDependencies[idx + 1] = accessDependencies[accessDependenciesExistingStart + 1];
        accessDependencies[accessDependenciesExistingStart] = key;
        accessDependencies[accessDependenciesExistingStart + 1] = tracker;
    }
}

function reconcileAccessDependencies<TObj extends {}, TTok> (listener: ChangeListener<TObj, TTok>, token: TTok) {
    for (let x = 0; x < accessDependenciesExistingStart; ) {
        const key = accessDependencies![x++];
        const tracker = accessDependencies![x++] as IChangeTracker<TObj>;
        tracker[removeListener](listener, key, token);
    }

    for (let x = accessDependenciesExistingEnd; x < accessDependencies!.length; ) {
        const key = accessDependencies![x++];
        const tracker = accessDependencies![x++] as IChangeTracker<TObj>;
        tracker[addListener](listener, key, token);
    }

    if (accessDependencies!.length - accessDependenciesExistingStart < accessDependenciesExistingStart) {
        accessDependencies!.splice(0, accessDependenciesExistingStart);
    }
    else {
        accessDependencies!.copyWithin(0, accessDependencies!.length - accessDependenciesExistingStart);
        accessDependencies!.splice(accessDependencies!.length - accessDependenciesExistingStart, accessDependenciesExistingStart);
    }
}

class ChainedSet<T> extends Set<T> {
    constructor(private readonly parent?: ChainedSet<T>) {
        super();
    }

    contains(val: T): boolean {
        let x: ChainedSet<T> | undefined = this;
        do {
            if (x.has(val)) return true;
            x = x.parent;
        }
        while(x !== undefined);
        return false;
    }
}

const protoToGettersAndSetters = new Map<object, { readonly getters: ChainedSet<string | symbol> | undefined; readonly setters: ChainedSet<string | symbol> | undefined ; }> ();

function createGettersAndSetters(proto: object): { readonly getters: ChainedSet<string | symbol> | undefined; readonly setters: ChainedSet<string | symbol> | undefined; } {
    const parentProto = Object.getPrototypeOf(proto);
    const parent = parentProto === null ? undefined :
        protoToGettersAndSetters.get(parentProto) ?? createGettersAndSetters(parentProto);

    let getters: ChainedSet<string | symbol> | undefined = undefined;
    let setters: ChainedSet<string | symbol> | undefined = undefined;

    const map = Object.getOwnPropertyDescriptors(proto);
    
    for (const name of Object.getOwnPropertyNames(map)) {
        const desc = map[name];
        if (desc.get !== undefined) {
            if (getters === undefined) getters = new ChainedSet(parent?.getters);
            getters.add(name);
        }
        if (desc.set !== undefined) {
            if (setters === undefined) setters = new ChainedSet(parent?.setters);
            setters.add(name);
        }
    }
    for (const sym of Object.getOwnPropertySymbols(map)) {
        const desc = (map as any)[sym];
        if (desc.get !== undefined) {
            if (getters === undefined) getters = new ChainedSet(parent?.getters);
            getters.add(sym);
        }
        if (desc.set !== undefined) {
            if (setters === undefined) setters = new ChainedSet(parent?.setters);
            setters.add(sym);
        }
    }

    const ret = { getters: getters ?? parent?.getters, setters: setters ?? parent?.setters };
    protoToGettersAndSetters.set(proto, ret);

    return ret;
}

function isGetter(obj: object, prop: string | symbol): boolean {
    const proto = Object.getPrototypeOf(obj);
    if (proto === null) return false;

    const lookup = protoToGettersAndSetters.get(proto)!;
    return lookup.getters?.contains(prop) ?? false;
}

function isSetter(obj: object, prop: string | symbol): boolean {
    const proto = Object.getPrototypeOf(obj);
    if (proto === null) return false;

    const lookup = protoToGettersAndSetters.get(proto)!;
    return lookup.setters?.contains(prop) ?? false;;
}

const getTrackerSymbol = Symbol("TrackingProxyHandler");
const getProxySymbol = Symbol("Target");

export const hasListeners: unique symbol = Symbol("hasListeners");

class TrackingProxyHandler<T extends { [hasListeners]?: boolean; }> implements ProxyHandler<T>, IChangeTracker<T> {
    #listeners?: any []; // we pack listeners in triplets for efficiency [key, listener, token]; when deleted all are undefined
    #listenersLen = 0;
    proxy!: T;

    constructor(target: T) {
        const proto = Object.getPrototypeOf(target);
        if (proto !== null) {
            if (!protoToGettersAndSetters.has(proto)) createGettersAndSetters(proto);
        }

        ++DependencyTrackingMetrics.allocatedProxies;
    }

    #notifyListeners(key: string | symbol) {
        const listeners = this.#listeners;
        const len = this.#listenersLen;

        if (listeners === undefined) return;

        for (let x = 0; x < len; x += 3) {
            const k = listeners[x];
            if (k === key) {
                const handler = listeners[x + 1] as ChangeListener<any, any>;
                const token = listeners[x + 2];
                try {
                    handler(this.proxy, token);
                }
                catch(err) {
                    console.log(err);
                }
            }
        }
    }

    [addListener]<TTok>(handler: ChangeListener<T, TTok>, key: any, token: TTok) {
        this.#listeners ??= [];

        const listeners = this.#listeners;
        let len = this.#listenersLen;

        const noListeners = len === 0;

        if (len < listeners.length) {
            listeners[len++] = key;
            listeners[len++] = handler;
            listeners[len++] = token;
            this.#listenersLen = len;
        }
        else {
            this.#listeners.push(key, handler, token);
            this.#listenersLen += 3;
        }

        if (noListeners) this.proxy[hasListeners] = true;

        ++DependencyTrackingMetrics.proxyListeners;
    }

    [removeListener]<TTok>(handler: ChangeListener<T, TTok>, key: any, token: any) {
        const listeners = this.#listeners;
        if (listeners === undefined) return;

        let len = this.#listenersLen;

        const idx = indexOfTriplet(listeners, key, handler, token, len);
        if (idx < 0) return;

        listeners[--len] = listeners[idx + 2];
        listeners[--len] = listeners[idx + 1];
        listeners[--len] = listeners[idx];
        listeners[idx + 2] = undefined;
        listeners[idx + 1] = undefined;
        listeners[idx + 0] = undefined;

        this.#listenersLen = len;

        if (len + len <= listeners.length) {
            listeners.splice(len);
        }

        if (len === 0) this.proxy[hasListeners] = false;

        --DependencyTrackingMetrics.proxyListeners;
    }

    get(target: T, property: string | symbol, receiver: any): any {
        if (property === getTrackerSymbol) return this;
        else if (property === getProxySymbol) return target;

        if (!isGetter(target, property)) {
            registerAccess?.(this, property);
        }
        return Reflect.get(target, property, receiver);
    }

    set(target: T, property: string | symbol, newValue: any, receiver: any): boolean {
        if (isSetter(target, property)) {
            return Reflect.set(target, property, newValue, receiver);
        }
        else {
            const changed = Reflect.get(target, property, receiver) !== newValue;
            const ret = Reflect.set(target, property, newValue, receiver);
            if (ret && changed) this.#notifyListeners(property);
            return ret;
        }
    }

    deleteProperty(target: T, property: string | symbol): boolean {
        const ret = Reflect.deleteProperty(target, property);
        if (ret) this.#notifyListeners(property);
        return ret;
    }

    defineProperty(target: T, property: string | symbol, attributes: PropertyDescriptor): boolean {
        const ret = Reflect.defineProperty(target, property, attributes);
        if (ret) this.#notifyListeners(property);
        return ret;
    }
}

class ArrayTrackingProxyHandlerBase<T> implements IArrayChangeTracker<T> {
    protected _perIndexListeners?: ((any | ChangeListener<T[], any>)[])[]; // one per array index, each member is an array where we pack listeners in pairs for efficiency [listener, token]
    protected _lengthListeners?: (any | ChangeListener<T[], any>)[];
    protected _listeners?: ArrayChangeListener<T>[];

    constructor() {
        ++DependencyTrackingMetrics.allocatedArrayProxies;
    }

    [addListener]<TTok>(handler: ChangeListener<T[], TTok>, key: any, token: TTok) {
        if (typeof key === 'number') {
            let map = this._perIndexListeners;
            if (map === undefined) {
                map = [];
                this._perIndexListeners = map;
            }
            let arr = map[key];
            if (arr === undefined) {
                arr = [];
                map[key] = arr;
            }
            arr.push(handler, token);
        }
        else if (key === 'length') {
            if (this._lengthListeners === undefined) this._lengthListeners = [];
            this._lengthListeners.push(handler, token);
        }
    }

    [removeListener]<TTok>(handler: ChangeListener<T[], TTok>, key: any, token: TTok) {
        if (typeof key === 'number') {
            const arr = this._perIndexListeners?.[key];
            if (arr === undefined) return;

            removePair(arr, handler, token);
        }
        else if (key === 'length') {
            const arr = this._lengthListeners;
            if (arr === undefined) return;

            removePair(arr, handler, token);
        }
    }

    [addArrayListener](handler: ArrayChangeListener<T>) {
        if (this._listeners === undefined) this._listeners = [];
        this._listeners.push(handler);

        ++DependencyTrackingMetrics.arrayProxyListeners;
    }

    [removeArrayListener](handler: ArrayChangeListener<T>) {
        if (this._listeners === undefined) return;
        const idx = this._listeners.indexOf(handler);
        if (idx < 0) return;
        this._listeners[idx] = this._listeners[this._listeners.length - 1];
        this._listeners.splice(this._listeners.length - 1, 1);
        
        ++DependencyTrackingMetrics.arrayProxyListeners;
    }
}

function notifyPlainListeners<T> (arr: T[], listenersAndTokens: (readonly (any | ChangeListener<T[], any>)[]) | undefined) {
    if (listenersAndTokens === undefined) return;

    for (let x = 0; x < listenersAndTokens.length; x += 2) {
        const handler = listenersAndTokens[x] as ChangeListener<T[], any>;
        const token = listenersAndTokens[x + 1];

        try {
            handler(arr, token);
        }
        catch(err) {
            console.log(err);
        }
    }
}

class ArrayTrackingProxyHandler<T> extends ArrayTrackingProxyHandlerBase<T> implements ProxyHandler<T[]> {
    proxy!: T[];

    #notifyArray(index: number, inserted: number, deleted: number, removedItems: T | T[] | undefined) {
        if (this._listeners === undefined) return;

        for(const listener of this._listeners) {
            listener(this.proxy, index, inserted, deleted, removedItems);
        }
    }

    #notifyComplexChange(index: number, inserted: number, deleted: number, removedItems: T | T[] | undefined) {
        this.#notifyArray(index, inserted, deleted, removedItems);

        if (this._perIndexListeners === undefined) return;

        if (inserted === deleted) {
            for (let x = index; x < index + inserted; ++x) {
                notifyPlainListeners(this.proxy, this._perIndexListeners[x]);
            }
        }
        else {
            for (let x = index; x < this._perIndexListeners.length; ++x) {
                notifyPlainListeners(this.proxy, this._perIndexListeners[x]);
            }
        }
    }

    #changeLength(real: T[], newLen: number) {
        const old = real.length;
        if (newLen < old) {
            const deleted = real.splice(newLen, old - newLen);
            this.#notifyArray(newLen, 0, deleted.length, deleted.length === 1 ? deleted[0] : deleted);
            notifyPlainListeners(this.proxy, this._lengthListeners);
        }
        else if (newLen > old) {
            real.length = newLen;
            this.#notifyArray(old, newLen - old, 0, undefined);
            notifyPlainListeners(this.proxy, this._lengthListeners);
        }
    }

    #notifySet(index: number, prevValue: T) {
        this.#notifyArray(index, 1, 1, prevValue);

        notifyPlainListeners(this.proxy, this._perIndexListeners?.[index]);
    }

    get(target: T[], property: string | symbol, _receiver: any): any {
        if (property === getTrackerSymbol) return this;
        else if (property === getProxySymbol) return target;

        if (property === 'push') return this.#push;
        else if (property === 'pop') return this.#pop;
        else if (property === 'shift') return this.#shift;
        else if (property === 'unshift') return this.#unshift;
        else if (property === 'splice') return this.#splice;
        else if (property === 'length') {
            registerAccess(this, 'length');
            return target.length;
        } else if (typeof property === 'string') {
            const idx = parseInt(property);
            if (!Number.isNaN(idx) && idx >= 0) {
                registerAccess(this, idx);
                return target[idx];
            }
            else {
                return (target as any)[property];
            }
        }
        else if (typeof property === 'number') {
            registerAccess(this, property);
            return target[property];
        }
        else {
            return (target as any)[property];
        }
    }

    set(target: T[], property: string | symbol, newValue: any, _receiver: any): boolean {
        if (property === 'length') {
            this.#changeLength(target, newValue);
        }
        else if (typeof property === 'string') {
            const idx = parseInt(property);
            if (!Number.isNaN(idx) && 0 <= idx && idx < target.length) {
                const old = target[idx];
                if (old !== newValue) {
                    target[idx] = newValue;
                    this.#notifySet(idx, old);
                }
            }
        }
        else if (typeof property === 'number') {
            if (0 <= property && property < target.length) {
                const old = target[property];
                if (old !== newValue) {
                    target[property] = newValue;
                    this.#notifySet(property, old);
                }
            }
        }

        return true;
    }

    deleteProperty(target: T[], property: string | symbol): boolean {
        if (typeof property === 'string') {
            const idx = parseInt(property);
            if (!Number.isNaN(idx) && 0 <= idx && idx < target.length) {
                const old = target[idx];
                if (old !== undefined) {
                    delete target[idx];
                    this.#notifySet(idx, old);
                }

                return true;
            }
            else {
                return false;
            }
        }
        else if (typeof property === 'number') {
            if (0 <= property && property < target.length) {
                const old = target[property];
                if (old !== undefined) {
                    delete target[property];
                    this.#notifySet(property, old);
                }
                return true;
            }
            else {
                return false;
            }
        }
        else {
            return Reflect.deleteProperty(target, property);
        }
    }

    #push(...items: T[]): number {
        const self = (this as any)[getTrackerSymbol] as ArrayTrackingProxyHandler<T>;
        const target = (this as any)[getProxySymbol] as T[];

        const len = target.length;
        const ret = target.push(...items);
        self.#notifyComplexChange(len, items.length, 0, undefined);

        return ret;
    }

    #pop(): T | undefined {
        const self = (this as any)[getTrackerSymbol] as ArrayTrackingProxyHandler<T>;
        const target =  (this as any)[getProxySymbol] as T[];

        const len = target.length;
        if (len === 0) return undefined;
        const ret = target.pop();
        self.#notifyComplexChange(len - 1, 0, 1, ret);
        return ret;
    }

    #shift(): T | undefined {
        const self = (this as any)[getTrackerSymbol] as ArrayTrackingProxyHandler<T>;
        const target =  (this as any)[getProxySymbol] as T[];

        if (target.length === 0) return undefined;
        const ret = target.shift();
        self.#notifyComplexChange(0, 0, 1, ret);
        return ret;
    }

    #unshift(...items: T[]): number {
        const self = (this as any)[getTrackerSymbol] as ArrayTrackingProxyHandler<T>;
        const target =  (this as any)[getProxySymbol] as T[];

        const ret = target.unshift(...items);
        self.#notifyComplexChange(0, items.length, 0, undefined);
        return ret;
    }

    #splice(start: number, deleteCount: number | undefined, ...items: T[]): T[] {
        const self = (this as any)[getTrackerSymbol] as ArrayTrackingProxyHandler<T>;
        const target =  (this as any)[getProxySymbol] as T[];

        if (deleteCount === undefined) deleteCount = target.length - start;
        else if (deleteCount + start > target.length) deleteCount = target.length - start;

        if (items !== undefined && items.length > 0) {
            const ret = target.splice(start, deleteCount, ...items);
            self.#notifyComplexChange(start, items.length, deleteCount, deleteCount === 0 ? undefined : deleteCount === 1 ? ret[0] : ret);
            return ret;
        }
        else {
            const ret = target.splice(start, deleteCount);
            self.#notifyComplexChange(start, 0, deleteCount, deleteCount === 0 ? undefined : deleteCount === 1 ? ret[0] : ret);
            return ret;
        }
    }
}

// Gives you back the proxy to the object. Using this proxy you can attach event listners
// to notify you when the object changes. The object is not modified in any way.

export function toTracked<T extends ({ [hasListeners]?: boolean; } | {})>(obj: T): T {
    if (Array.isArray(obj)) {
        const handler = new ArrayTrackingProxyHandler<any>();
        const ret = new Proxy(obj, handler);
        handler.proxy = ret;
        return ret as unknown as T;
    }
    else {
        const handler = new TrackingProxyHandler<T>(obj);
        const ret = new Proxy(obj, handler);
        handler.proxy = ret;
        return ret;
    }
}

// Given a proxy to a tracked object returns the object you can use to listen to its changes

export function getTracker<T extends {}>(obj: T): T extends (infer ElementType)[] ? IArrayChangeTracker<ElementType> | undefined : IChangeTracker<T> | undefined {
    return (obj as any)?.[getTrackerSymbol];
}

const dependencyChain: (any[] | number | undefined)[] = [];

export function startEvalScope(dependencies: any[]) {
    dependencyChain.push(accessDependencies);
    dependencyChain.push(accessDependenciesExistingStart);
    dependencyChain.push(accessDependenciesExistingEnd);

    accessDependencies = dependencies;
    accessDependenciesExistingStart = accessDependenciesExistingEnd = dependencies.length;
}

export function evalTrackedScoped(s: string, thisArg: any,) {
    const func = Function("self", "window", "globals", "console", "top", `"use strict";return (${s});`);
    return func.apply(thisArg);
}

export function endEvalScope<TObj extends {}, TTok>(listener: ChangeListener<TObj, TTok>, token: TTok) {
    ++DependencyTrackingMetrics.evals;
    
    reconcileAccessDependencies(listener, token);

    accessDependenciesExistingEnd = dependencyChain.pop() as number;
    accessDependenciesExistingStart = dependencyChain.pop() as number;
    accessDependencies = dependencyChain.pop() as undefined | any[];
}

export function evalTracked<TObj extends {}, TTok>(s: string, thisArg: any, listener: ChangeListener<TObj, TTok>, token: TTok, dependencies: any[]) {
    ++DependencyTrackingMetrics.evals;

    const prevDependencies = accessDependencies;
    const prevStart = accessDependenciesExistingStart;
    const prevEnd = accessDependenciesExistingEnd;

    accessDependencies = dependencies;
    accessDependenciesExistingStart = accessDependenciesExistingEnd = dependencies.length;

    try {
        const func = Function("self", "window", "globals", "console", "top", `"use strict";return (${s});`);
        return func.apply(thisArg);
    }
    finally {
        reconcileAccessDependencies(listener, token);

        accessDependencies = prevDependencies;
        accessDependenciesExistingStart = prevStart;
        accessDependenciesExistingEnd = prevEnd;
    }
}

export function clearDependencies<TObj extends {}, TTok>(listener: ChangeListener<TObj, TTok>, token: TTok, dependencies: any[]) {
    ++DependencyTrackingMetrics.clears;

    for (let x = 0; x < dependencies.length; x += 2) {
        const key = dependencies[x];
        const tracker = dependencies[x + 1] as IChangeTracker<TObj>;
        tracker[removeListener](listener, key, token);
    }
    dependencies.splice(0);
}