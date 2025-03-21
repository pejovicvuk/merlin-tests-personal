import { AsyncDemux1, map } from "./algorithms.js";
import { AmbientProperty, BindableControl, BindableProperty, setOrRemoveAttribute } from "./bindable-control.js";
import { cancelTaskExecution, enqueTask } from "./task-queue.js";

function callHandler(event: Event, type: string) {
    if (event.currentTarget === null) return;
    const element = event.currentTarget as HtmlControl;
    if (element.enabled === false) return;
    
    const attr = element.getAttribute(type);
    if (attr === null) return;
    const model = element.model;

    const func = Function("element", "event", "self", "window", "globals", "console", "top", `"use strict";return (${attr});`);
    func.call(model, element, event);
}

const events = [
    "animationcancel", "animationend", "animationiteration", "animationstart", "afterscriptexecute", "auxclick",
    "blur", "click", "compositionend", "compositionstart", "compositionupdate", "contextmenu",
    "copy", "cut", "dblclick", "error", "focusin", "focusout", "focus", "fullscreenchange", "fullscreenerror", "gesturechange",
    "gestureend", "gesturestart", "gotpointercapture", "keydown", "keypress", "keyup", "lostpointercapture", "mousedown",
    "mouseenter", "mouseleave", "mousemove", "mouseout", "mouseover", "mouseup", "mousewheel", "paste", "pointercancel",
    "pointerdown", "pointerenter", "pointerleave", "pointermove", "pointerout", "pointerover", "pointerup", "scroll",
    "select", "touchcancel", "touchend", "touchmove", "touchstart", "transitioncancel", "transitionend", "transitionrun",
    "transitionstart", "wheel", "drag", "dragend", "dragenter", "dragleave", "dragover", "dragstart", "drop"
];

const eventsToEventHandlers = new Map(events.map(x => ['on-' + x, (ev: Event) => callHandler(ev, 'on-' + x)]));

export type HtmlControlBindableProperty<T extends string, R> = BindableProperty<T, R> & {
    readonly [_ in `on${Capitalize<T>}Changed`]: () => void;
};

export type HtmlControlAmbientProperty<T extends string, R> = AmbientProperty<T, R> & {
    readonly [_ in `on${Capitalize<T>}Changed`]: () => void;
};

const changedHandlerMap = new Map<string, string>();

function getChangedHanlderName(property: string) {
    let ret = changedHandlerMap.get(property);
    if (ret === undefined) {
        ret = 'on' + property[0].toUpperCase() + property.slice(1) + 'Changed';
        changedHandlerMap.set(property, ret);
    }
    return ret;
}

class CssDownloader extends AsyncDemux1<string, CSSStyleSheet> {
    protected override async callReal(address: string, signal: AbortSignal): Promise<CSSStyleSheet> {
        var cssRequest = await fetch(address, { signal });
        if (!cssRequest.ok) throw new Error(`Could not load '${address}'.`);
        return await new CSSStyleSheet({ baseURL: document.URL }).replace(await cssRequest.text());
    }
    
}

const cssDownloader = new CssDownloader(true);

const downlodedStyleSheets = new Map<string, CSSStyleSheet | null>();

export class HtmlControl extends BindableControl implements
    HtmlControlBindableProperty<'classes', string | undefined>,
    HtmlControlBindableProperty<'states', string | undefined>,
    HtmlControlBindableProperty<'canDrag', boolean | undefined>,
    HtmlControlBindableProperty<'adoptedStyleSheets', readonly CSSStyleSheet[] | CSSStyleSheet | undefined>,
    HtmlControlAmbientProperty<'enabled', boolean | undefined>  {

    readonly #scheduledEvaluations = new Map<string, number>();
    #lastKnownClasses?: string
    #numAdoptedStyleSheets?: number;
    #internals?: ElementInternals;
    #explicitEnabled?: boolean;
    #explicitAdoptedStyleSheets?: readonly CSSStyleSheet[] | CSSStyleSheet;
    #lastKnownAdoptedStyleSheets?: readonly CSSStyleSheet[] | CSSStyleSheet

    static override readonly bindableProperties = [...BindableControl.bindableProperties, 'classes', 'states', 'canDrag', 'adoptedStyleSheets'];
    static override ambientProperties = [...BindableControl.ambientProperties, 'enabled'];
    static override readonly additionalAttributes = [...BindableControl.additionalAttributes, 'style-sheets', ...map(events, x => 'on-' + x)];

    get classes() {
        return this.getProperty<string | undefined>('classes', undefined);
    }

    onClassesChanged() {
        let classes: string | undefined = undefined;
        if (this.isPartOfDom) {
            try {
                const ac = this.classes;
                classes = typeof ac === 'string' ? ac : undefined;
            }
            catch(err) {
                console.log(err);
            }
        }

        if (this.#lastKnownClasses === classes) return;

        const oldClasses = this.#lastKnownClasses?.split(/ +/);
        const newClasses = classes?.split(/ +/);

        if (oldClasses !== undefined) {
            for (const cls of oldClasses) {
                if (newClasses === undefined || newClasses.indexOf(cls) < 0) {
                    this.classList.remove(cls);
                }
            }
        }
        if (newClasses !== undefined) {
            for (const cls of newClasses) {
                if (oldClasses === undefined || oldClasses.indexOf(cls) < 0) {
                    this.classList.add(cls);
                }
            }
        }

        this.#lastKnownClasses = classes;
    }

    get enabled() {
        return this.getProperty<boolean | undefined>('enabled', this.#explicitEnabled);
    }

    set enabled(val: boolean | undefined) {
        const prev = this.#explicitEnabled;
        this.#explicitEnabled = val;
        this.notifyPropertySetExplicitly('enabled', prev, val);
    }

    get hasExplicitEnabled() {
        return this.#explicitEnabled !== undefined;
    }

    onEnabledChanged() {
    }

    get styleSheets() {
        return this.getAttribute('style-sheets');
    }

    set styleSheets(s: string | null) {
        setOrRemoveAttribute(this, 'style-sheets', s);
    }

    onStyleSheetsChanged() {
        this.#evaluateStyleSheets();
    }

    get adoptedStyleSheets() {
        return this.getProperty<readonly CSSStyleSheet[] | CSSStyleSheet | undefined>('adoptedStyleSheets', this.#explicitAdoptedStyleSheets);
    }

    set adoptedStyleSheets(sheets: readonly CSSStyleSheet[] | CSSStyleSheet | undefined) {
        const old = this.#explicitAdoptedStyleSheets;
        this.#explicitAdoptedStyleSheets = sheets;
        this.notifyPropertySetExplicitly('adoptedStyleSheets', old, this.#explicitAdoptedStyleSheets);
    }

    onAdoptedStyleSheetsChanged() {
        let ss: readonly CSSStyleSheet[] | CSSStyleSheet | undefined;
        try {
            ss = this.adoptedStyleSheets;
        }
        catch{
            ss = undefined;
        }

        if (ss === this.#lastKnownAdoptedStyleSheets) return;
        
        if (this.#lastKnownAdoptedStyleSheets instanceof Array) {
            for(const sts of this.#lastKnownAdoptedStyleSheets) {
                this.unadoptStyleSheet(sts);
            }
        }
        else if (typeof this.#lastKnownAdoptedStyleSheets === 'object') {
            this.unadoptStyleSheet(this.#lastKnownAdoptedStyleSheets);
        }

        if (ss instanceof Array) {
            for(const sts of ss) {
                this.adoptStyleSheet(sts);
            }
        }
        else if (typeof ss === 'object') {
            this.adoptStyleSheet(ss);
        }

        this.#lastKnownAdoptedStyleSheets = ss;
    }

    get states() {
        return this.getProperty<string | undefined>('states');
    }

    onStatesChanged() {
        let states: string | undefined = undefined;
        if (this.isPartOfDom) {
            try {
                const ac = this.states;
                states = typeof ac === 'string' ? ac : undefined;
            }
            catch(err) {
                console.log(err);
            }
        }

        if (this.#internals === undefined && states === undefined) return;

        this.#internals ??= this.attachInternals();
        
        const real = this.#internals.states;
        const incoming = states?.split(/ +/);

        for (const state of real) {
            if (incoming === undefined || incoming.indexOf(state) < 0) {
                real.delete(state);
            }
        }
        if (incoming !== undefined) {
            for (const state of incoming) real.add(state);
        }
    }

    get canDrag() {
        return this.getProperty<boolean | undefined>('canDrag');
    }

    onCanDragChanged() {
        let canDrag: boolean | undefined = undefined;
        try {
            canDrag = this.canDrag;
        }
        catch{
        }

        setOrRemoveAttribute(this, 'draggable', canDrag === true ? 'true' : null);
    }

    #evaluatePropertyCallbackImpl(property: string): void {
        this.#scheduledEvaluations.delete(property);
        const handler = (this as Record<string, any>)[getChangedHanlderName(property)];
        if (typeof handler === 'function') handler.call(this);
    }

    #evaluatePropertyCallback = (property: string) => this.#evaluatePropertyCallbackImpl(property);

    override onPropertyChanged(property: string): void {
        if (!this.isPartOfDom) return;

        if (!this.#scheduledEvaluations.has(property)) {
            this.#scheduledEvaluations.set(property, enqueTask(this.#evaluatePropertyCallback, property));
        }

        super.onPropertyChanged(property);
    }

    #styleSheetDownloadController?: AbortController;

    #evaluateStyleSheets() {
        if (this.isPartOfDom && this.shadowRoot !== null && this.styleSheets !== null) {
            this.#styleSheetDownloadController?.abort()
            this.#styleSheetDownloadController = undefined;

            const ss = this.styleSheets;
        
            let links: string[] | undefined = undefined;

            let start = 0;
            while(start < ss.length) {
                const maybeSpace = ss.indexOf(' ', start);
                const space = maybeSpace < 0 ? ss.length : maybeSpace;
                if (space === start) {
                    ++start;
                    continue;
                }
                else {
                    const id = ss.substring(start, space);

                    const link = document.getElementById(id);
                    if (link !== null && link instanceof HTMLLinkElement && link.rel === 'stylesheet' && link.href != '') {
                        links ??= [];
                        links.push(link.href);
                    }

                    start = space + 1;
                }
            }

            if (links !== undefined) {
                let x = 0;
                for(; x < links.length; ++x) {
                    const existing = downlodedStyleSheets.get(links[x]);
                    if (existing === undefined) break;
                    if (existing !== null) this.shadowRoot.adoptedStyleSheets.push(existing);
                }

                if (x < links.length) {
                    links.splice(0, x);

                    const ac = new AbortController();
                    this.#styleSheetDownloadController = ac;

                    this.#evaluateStyleSheetsAsync(this.shadowRoot, ac.signal, links);
                }
            }
        }
        else {
            this.shadowRoot?.adoptedStyleSheets.splice(this.#numAdoptedStyleSheets ?? 0);

            this.#styleSheetDownloadController?.abort();
            this.#styleSheetDownloadController = undefined;
        }
    }

    async #evaluateStyleSheetsAsync(shadow: ShadowRoot, sig: AbortSignal, links: readonly string[]) {
        for(const link of links) {
            const existing = downlodedStyleSheets.get(link);
            if (existing !== undefined) {
                if (existing !== null) shadow.adoptedStyleSheets.push(existing);
            }
            else {
                try {
                    const sheet = await cssDownloader.call(link, sig);
                    if(sig.aborted) break;
                    downlodedStyleSheets.set(link, sheet);
                    shadow.adoptedStyleSheets.push(sheet);
                }
                catch(reason) {
                    if (!sig.aborted) console.error(reason);
                }
            }
        }

        if (sig === this.#styleSheetDownloadController?.signal) this.#styleSheetDownloadController = undefined;
    }

    override attachShadow(init: ShadowRootInit): ShadowRoot {
        const ret = super.attachShadow(init);

        this.#evaluateStyleSheets();

        return ret;
    }

    override onConnectedToDom(): void {
        super.onConnectedToDom();

        this.#evaluateStyleSheets();
    }

    override onDisconnectedFromDom(): void {
        for (const taskId of this.#scheduledEvaluations.values()) {
            cancelTaskExecution(taskId);
        }

        this.#scheduledEvaluations.clear();

        this.#styleSheetDownloadController?.abort();
        this.#styleSheetDownloadController = undefined;

        super.onDisconnectedFromDom();
    }

    override attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        super.attributeChangedCallback(name, oldValue, newValue);

        if (name == 'style-sheets') {
            this.#evaluateStyleSheets();
        }
        else {
            const func = eventsToEventHandlers.get(name);
            if (func !== undefined) {
                const event = name.substring(3);

                if (oldValue === null && newValue !== null) {
                    this.addEventListener(event, func);
                }
                else if (oldValue !== null && newValue === null) {
                    this.removeEventListener(event, func);
                }
            }
        }
    }

    adoptStyleSheet(css: CSSStyleSheet) {
        const idx = this.#numAdoptedStyleSheets ?? 0;
        this.shadowRoot!.adoptedStyleSheets.splice(idx, 0, css);
        this.#numAdoptedStyleSheets = idx + 1;
    }

    unadoptStyleSheet(css: CSSStyleSheet) {
        const numAdopted = this.#numAdoptedStyleSheets ?? 0;
        const idx = this.shadowRoot!.adoptedStyleSheets.indexOf(css);
        if (idx >= 0 && idx < numAdopted) {
            this.shadowRoot!.adoptedStyleSheets.splice(idx, 1);
            this.#numAdoptedStyleSheets = numAdopted - 1;
        }
    }
}