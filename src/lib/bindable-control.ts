import { contains, indexOfTriplet, map } from "./algorithms.js";
import { IChangeTracker, clearDependencies, startEvalScope, endEvalScope, registerAccess, addListener, removeListener } from "./dependency-tracking.js";
import { HtmlControlCore } from "./html-control-core.js";

function stringToDashedLowercase(s: string) {
    return '-' + s.toLowerCase();
}

function propertyNameToAttributeName(s: string) {
    return s.replace(/([A-Z])/g, stringToDashedLowercase);
}

function dashedLowerCaseToPascal(s: string) {
    return s.substring(1).toUpperCase();
}

function dashToCamel(s: string){
    return s.replace(/(\-[a-z])/g, dashedLowerCaseToPascal);
}

const undefinedPlaceholder = {};

interface AncestorsKey {};

const ancestorsKey: AncestorsKey = {};

function hasExplicit<T extends {}>(obj: T, hasExplicitPropertyName: string) {
    return (obj as Record<string, any>)[hasExplicitPropertyName] === true;
}

const hasExplicitPropertyNameMap = new Map<string, string>();

function getHasExplicitPropertyName(name: string) {
    let ret = hasExplicitPropertyNameMap.get(name);
    if (ret === undefined) {
        ret = 'hasExplicit' + name[0].toUpperCase() + name.slice(1);
        hasExplicitPropertyNameMap.set(name, ret);
    }
    return ret;
}

function propagatePropertyChangeInternal(element: HtmlControlCore, name: string, hasExplicitPropertyName: string, attributeName: string) {
    for (const child of element.childControls) {
        if (child instanceof BindableControl) {
            const ctor = child.constructor as Function & { bindableProperties?: Iterable<string>; ambientProperties?: Iterable<string>; };

            const hasLocal = ctor.bindableProperties !== undefined && contains(ctor.bindableProperties, name);
            if (hasLocal) continue;

            const hasAmbient = ctor.ambientProperties !== undefined && contains(ctor.ambientProperties, name);

            if (hasAmbient) {
                if (hasExplicit(child, hasExplicitPropertyName) || child.hasAttribute(attributeName)) continue;
                
                child.notifyInheritedPropertyChanged(name);
            }
        }

        propagatePropertyChangeInternal(child, name, hasExplicitPropertyName, attributeName);
    }
}

function propagatePropertyChange(element: HtmlControlCore, name: string) {
    if (!element.isPartOfDom) return;

    propagatePropertyChangeInternal(element, name, getHasExplicitPropertyName(name), propertyNameToAttributeName(name));
}

export function setOrRemoveAttribute(element: Element, qualifiedName: string, val: string | null) {
    if (val !== null) {
        element.setAttribute(qualifiedName, val);
    }
    else {
        element.removeAttribute(qualifiedName);
    }
}

export type BindableProperty<T extends string, R> = {
    [_ in T]: R | undefined;
};

export type AmbientProperty<T extends string, R> = BindableProperty<T, R> & {
    readonly [_ in `hasExplicit${Capitalize<T>}`]: boolean;
};

export class BindableControl extends HtmlControlCore implements IChangeTracker<object>, AmbientProperty<'model', any> {
    #bindingDependencies?: Map<string, any[]>; // for each binding the array of dependencies obtained using evalTracked. the key is the attribute name, not the camel-cased property name
    #bindingValues?: Map<string, any>;
    #bindingExceptions?: Map<string, any>;
    #listeners?: any []; // we pack listeners in triples for efficiency, (key, listener, token)
    #model?: any;

    static readonly bindableProperties: Iterable<string> = [];
    static readonly ambientProperties: Iterable<string> = ['model'];
    static readonly additionalAttributes: Iterable<string> = [];

    static get observedAttributes() {
        return [...map(this.bindableProperties, propertyNameToAttributeName), ...map(this.ambientProperties, propertyNameToAttributeName), ...this.additionalAttributes];
    }

    override onConnectedToDom(): void {
        super.onConnectedToDom();

        const ctor = this.constructor as Function & { bindableProperties?: Iterable<string>; ambientProperties?: Iterable<string>; };
        if (ctor.bindableProperties !== undefined || ctor.ambientProperties !== undefined) {
            this.#bindingValues?.clear();
            this.#bindingExceptions?.clear();

            if (ctor.bindableProperties !== undefined) {
                for (const prop of ctor.bindableProperties) {
                    this.#notifyListeners(prop);
                }
            }

            if (ctor.ambientProperties !== undefined) {
                for (const prop of ctor.ambientProperties) {
                    this.#notifyListeners(prop);
                }
            }

            this.#notifyListeners(ancestorsKey);
        }
    }

    override onAncestorsChanged(): void {
        this.#notifyListeners(ancestorsKey);
    }

    override onDisconnectedFromDom(): void {
        super.onDisconnectedFromDom();

        if (this.#bindingDependencies !== undefined) {
            for (const [prop, dependencies] of this.#bindingDependencies.entries()) {
                clearDependencies(this.#onChanged, prop, dependencies);
            }
            this.#bindingDependencies = undefined;
        }

        const ctor = this.constructor as Function & { bindableProperties?: Iterable<string>; ambientProperties?: Iterable<string>; };
        if (ctor.bindableProperties !== undefined || ctor.ambientProperties !== undefined) {
            this.#bindingValues?.clear();
            this.#bindingExceptions?.clear();
        }
    }

    get #parentModel() {
        registerAccess(this, ancestorsKey);

        let ctl = this.parentControl;
        while (ctl !== undefined) {
            if (ctl instanceof BindableControl) return ctl.model;
            ctl = ctl.parentControl;
        }

        return undefined;
    }

    #evaluateBinding(name: string) {
        const maybeVal = this.#bindingValues?.get(name)
        if (maybeVal !== undefined) return maybeVal !== undefinedPlaceholder ? maybeVal : undefined;

        const maybeEx = this.#bindingExceptions?.get(name);
        if (maybeEx !== undefined) throw maybeEx;

        if (!this.isPartOfDom) {
            if (this.#bindingValues === undefined) this.#bindingValues = new Map();
            this.#bindingValues.set(name, undefinedPlaceholder);
            return undefined;
        }

        const attr = this.getAttribute(propertyNameToAttributeName(name));
        if (attr === null) {
            if (this.#bindingValues === undefined) this.#bindingValues = new Map();
            this.#bindingValues.set(name, undefinedPlaceholder);
            return undefined;
        }

        if (this.#bindingDependencies === undefined) this.#bindingDependencies = new Map();
        let dependencies = this.#bindingDependencies.get(name);
        if (dependencies === undefined) {
            dependencies = [];
            this.#bindingDependencies.set(name, dependencies);
        }
        startEvalScope(dependencies);

        try {
            const thisVal = attr.indexOf('this') < 0 ? undefined :
                name === 'model' ? this.#parentModel : this.model;

            const func = Function("element", "self", "window", "globals", "console", "top", `"use strict";return (${attr});`);
            const val = func.call(thisVal, this);
        
            this.#bindingExceptions?.delete(name);
            if (this.#bindingValues === undefined) this.#bindingValues = new Map();
            this.#bindingValues.set(name, val === undefined ? undefinedPlaceholder : undefined);
            return val;
        }
        catch(ex) {
            this.#bindingValues?.delete(name);
            if (this.#bindingExceptions === undefined) this.#bindingExceptions = new Map();
            this.#bindingExceptions.set(name, ex);
            throw ex;
        }
        finally {
            endEvalScope(this.#onChanged, name);
        }
    }

    onPropertyChanged(property: string): void {
    }

    #notifyListeners(name: string | AncestorsKey) {
        if (typeof name === 'string') this.onPropertyChanged(name);

        if (this.#listeners === undefined) return;

        for (let x = 0; x < this.#listeners.length; x += 3) {
            const k = this.#listeners[x];
            if (k === name) {
                const listener = this.#listeners[x + 1] as (obj: object, token: any) => void;
                const token = this.#listeners[x + 2];
                try {
                    listener(this, token);
                }
                catch(err) {
                    console.log(err);
                }
            }
        }
    }

    #clearBindingCache(name: string): boolean | undefined {
        return (this.#bindingValues?.delete(name) || this.#bindingExceptions?.delete(name));
    }

    [addListener]<TTok>(handler: (obj: object, token: TTok) => void, key: any, token: TTok) {
        if (this.#listeners === undefined) this.#listeners = [];
        this.#listeners.push(key, handler, token);
    }

    [removeListener]<TTok>(handler: (obj: object, token: TTok) => void, key: any, token: TTok) {
        const listeners = this.#listeners;
        if (listeners === undefined) return;

        const idx = indexOfTriplet(listeners, key, handler, token);
        if (idx < 0) return;

        const lastIdx = listeners.length - 3;
    
        listeners[idx] = listeners[lastIdx];
        listeners[idx + 1] = listeners[lastIdx + 1];
        listeners[idx + 2] = listeners[lastIdx + 2];
    
        listeners.splice(lastIdx, 3);
    }

    #onChangedImpl(obj: object, name: string) {
        if (this.#clearBindingCache(name)) {
            this.#notifyListeners(name);

            const ctor = this.constructor as {ambientProperties?: Iterable<string>; };
            const isAmbient = ctor.ambientProperties !== undefined && contains(ctor.ambientProperties, name);

            if (isAmbient && !hasExplicit(this, getHasExplicitPropertyName(name))) {
                propagatePropertyChange(this, name);
            }
        }
    }

    #onChanged = (obj: object, name: string) => this.#onChangedImpl(obj, name);

    override attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        super.attributeChangedCallback(name, oldValue, newValue);

        if (!this.isPartOfDom) return;

        const camel = dashToCamel(name);

        const ctor = this.constructor as { bindableProperties?: Iterable<string>; ambientProperties?: Iterable<string>; };

        const isLocal = ctor.bindableProperties !== undefined && contains(ctor.bindableProperties, camel);
        const isAmbient = ctor.ambientProperties !== undefined && contains(ctor.ambientProperties, camel);

        if (!isLocal && !isAmbient) return;

        this.#clearBindingCache(camel);
        this.#notifyListeners(camel);

        if (isAmbient && !hasExplicit(this, getHasExplicitPropertyName(camel))) {
            propagatePropertyChange(this, camel);
        }
    }

    getProperty<T>(name: string, explicitVal?: T): T | undefined {
        registerAccess(this, name);

        if (explicitVal !== undefined) {
            return explicitVal;
        }
        else if (this.hasAttribute(propertyNameToAttributeName(name))) {
            return this.#evaluateBinding(name);
        }
        else {
            const ctor = this.constructor as { ambientProperties?: Iterable<string>; };
            if (ctor.ambientProperties !== undefined && contains(ctor.ambientProperties, name)) {
                registerAccess(this, ancestorsKey);

                const explicitPropertyName = getHasExplicitPropertyName(name);
                const attr = propertyNameToAttributeName(name);

                let ctl = this.parentControl;
                while (ctl !== undefined) {
                    if (ctl instanceof BindableControl) {
                        const ctlCtor = ctl.constructor as { ambientProperties?: Iterable<string>; };
                        if (ctlCtor.ambientProperties !== undefined && contains(ctlCtor.ambientProperties, name)) {
                            if (hasExplicit(ctl, explicitPropertyName) || ctl.hasAttribute(attr)) return (ctl as Record<string, any>)[name];
                        }
                    }

                    ctl = ctl.parentControl;
                }
            }

            return undefined;
        }
    }

    notifyPropertySetExplicitly<T>(name: string, oldValue: T, newValue: T) {
        if (!this.isPartOfDom) return;

        this.#clearBindingCache(name);
        this.#notifyListeners(name);

        if ((oldValue !== undefined) !== (newValue !== undefined) && !this.hasAttribute(propertyNameToAttributeName(name))) {
            const ctor = this.constructor as { ambientProperties?: Iterable<string>; };
            if (ctor.ambientProperties !== undefined && contains(ctor.ambientProperties, name)) {
                propagatePropertyChange(this, name);
            }
        }
    }

    notifyInheritedPropertyChanged(name: string) {
        this.#clearBindingCache(name);
        this.#notifyListeners(name);
    }

    get model() {
        return this.getProperty('model', this.#model);
    }

    set model(val: any) {
        if (this.#model === val) return;
        
        const old = this.#model;
        this.#model = val;
        this.notifyPropertySetExplicitly('model', old, val);
    }

    get hasExplicitModel() {
        return this.#model !== undefined;
    }

    writeToBindingSource<T>(property: keyof this, val: T): boolean {
        if (typeof property !== 'string') throw new Error('Cannot use a non-string property.');
        const attributeName = propertyNameToAttributeName(property);
        return this.writeToBindingSourceByAttribute(attributeName, val);
    }

    writeToBindingSourceByAttribute<T>(attributeName: string, val: T): boolean {
        const expression = this.getAttribute(attributeName);
        if (expression === null) return false;

        if (!expression.startsWith('this.')) return false;

        let obj = this.model;
        if (obj == null) return false;

        if (typeof obj !== 'object') return false;

        let start = 5;
        for (;;) {
            const dotIdx = expression.indexOf('.', start);
            if (dotIdx < 0) {
                const member = expression.slice(start);
                obj[member] = val;
                return true;
            }
            else {
                if (dotIdx === start) return false;

                const member = expression.slice(start, dotIdx);
                start = dotIdx + 1;
                obj = obj[member];
                if (typeof obj !== 'object') return false;
            }
        }
    }
}
