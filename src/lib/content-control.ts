import { BindableControl } from "./bindable-control.js";
import { findTemplateById, getTypeName } from "./dom-utilities.js";
import { HtmlControl, HtmlControlBindableProperty } from "./html-control.js";

const shadowHtml = '<slot name="template"></slot><slot name="content"></slot>';

const standardTemplate = document.createElement('template');
standardTemplate.innerHTML = '<text-block text="this"></text-block>';

const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(`
    :host { display: contents; }
`);

export class ContentControl extends HtmlControl implements HtmlControlBindableProperty<'content', any>, HtmlControlBindableProperty<'itemToTemplateId', (item: any) => string> {
    static override bindableProperties = [...HtmlControl.bindableProperties, 'content', 'itemToTemplateId'];

    #itemToTemplateId?: (item: any) => string;
    #content?: any;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: "open", delegatesFocus: true });
        shadow.innerHTML = shadowHtml;

        const slot = this.#itemTemplateSlot;
        slot.addEventListener('slotchange', ContentControl.#onSlotChangeShared);

        this.adoptStyleSheet(styleSheet);
    }

    get content(): any {
        return this.getProperty('content');
    }

    onContentChanged() {
        this.#updateContent();
    }

    static #onSlotChangeShared(this: HTMLSlotElement, ev: Event) {
        ((this.parentNode as ShadowRoot).host as ContentControl).#onSlotChange();
        ev.stopPropagation();
    }

    #assignedElementsCache?: Element[];

    #onSlotChange () {
        this.#assignedElementsCache = undefined;

        if (this.#content !== undefined) this.#updateContent();
    }

    get #itemTemplateSlot() {
        return this.shadowRoot!.querySelector('slot[name="template"]') as HTMLSlotElement;
    }

    get #contentSlot() {
        return this.shadowRoot!.querySelector('slot[name="content"]') as HTMLSlotElement;
    }
    
    get itemToTemplateId(): ((item: any) => string) | undefined {
        return this.getProperty('itemToTemplateId', this.#itemToTemplateId);
    }

    set itemToTemplateId(func: ((item: any) => string) | undefined) {
        const prev = this.#itemToTemplateId;
        this.#itemToTemplateId = func;
        this.notifyPropertySetExplicitly('itemToTemplateId', prev, func);
    }

    onItemToTemplateIdChanged() {
        if (this.#content !== undefined) this.#updateContent();
    }

    getItemToTemplateId(item: any): string {
        return (this.itemToTemplateId ?? getTypeName)(item);
    }

    #getItemTemplateContent(item: any): DocumentFragment {
        const name = this.getItemToTemplateId(item);

        this.#assignedElementsCache ??= this.#itemTemplateSlot.assignedElements();

        let anonymous: HTMLTemplateElement | undefined = undefined;
        let numAnonymous = 0;
        let numNamed = 0;

        for(const template of this.#assignedElementsCache) {
            if (!(template instanceof HTMLTemplateElement)) continue;

            if (template.id === name) return template.content;
            else if (template.id === "") {
                anonymous = template;
                ++numAnonymous;
            }
            else {
                ++numNamed;
            }
        }

        if (numAnonymous === 1 && numNamed === 0 && anonymous !== undefined) {
            return anonymous.content;
        }
        else {
            return (findTemplateById(this, name) ?? standardTemplate).content;
        }
    }

    #updateContent() {
        const prevcontent = this.#content;

        try {
            this.#content = this.content;
        }
        catch {
            this.#content = undefined;
        }
    
        if (this.#content === prevcontent) return;

        const slot = this.#contentSlot;

        const assigned = slot.assignedElements();

        if (this.getItemToTemplateId(this.#content) === this.getItemToTemplateId(this.#content) && assigned.length > 0) {
            for (const el of assigned) {
                (el as BindableControl).model = this.#content;
            }
        }
        else {
            for (const el of assigned) el.remove();

            if (this.#content !== undefined) {
                const container = document.createElement('model-control') as BindableControl;
                const template = this.#getItemTemplateContent(this.#content);
                container.append(template.cloneNode(true));
                container.model = this.#content;
                container.slot = 'content';
    
                this.appendChild(container);
            }
        }
    }
}