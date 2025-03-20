import { BindableControl } from "./bindable-control.js";
import { addArrayListener, getTracker } from "./dependency-tracking.js";
import { findTemplateById, getTypeName } from "./dom-utilities.js";
import { HtmlControl, HtmlControlBindableProperty } from "./html-control.js";

const standardTemplate = document.createElement('template');
standardTemplate.innerHTML = '<text-block text="this"></text-block>';

const shadowHtml = '<slot name="item-template"></slot><slot name="item-container-template"><template><model-control></model-control></template></slot><div part="container"></div>';

export class ItemsControl extends HtmlControl implements HtmlControlBindableProperty<'items', Iterable<any>>, HtmlControlBindableProperty<'itemToTemplateId', (item: any) => string> {
    static override bindableProperties = [...HtmlControl.bindableProperties, 'items', 'itemToTemplateId', 'virtualized'];

    #displayedItems?: Iterable<any>;
    #slotCount = 0;
    #itemToTemplateId?: (item: any) => string;
    #virtualized = false;

    // For virtualization
    #renderedItems = new Set<number>();
    #intersectionObserverBottom?: IntersectionObserver;
    #deletedItems = new Set<number>(); 
    #itemWasRecentlyDeleted = false;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: "open", delegatesFocus: true });
        shadow.innerHTML = shadowHtml;

        const templateSlot = this.#itemTemplateSlot;
        templateSlot.addEventListener('slotchange', ItemsControl.#onSlotChangeShared);

        const itemContainerTemplateSlot = this.#itemContainerTemplateSlot;
        itemContainerTemplateSlot.addEventListener('slotchange', ItemsControl.#onSlotChangeShared);
    }

    static #onSlotChangeShared(this: HTMLSlotElement, ev: Event) {
        ((this.parentNode as ShadowRoot).host as ItemsControl).#rebuildItems();
        ev.stopPropagation();
    }

    #assignedElementsCache?: Element[];

    #rebuildItems() {
        this.#assignedElementsCache = undefined;
        this.#itemContainerTemplate = undefined;

        // If virtualized and items have already been rendered, don't rebuild
        if (this.virtualized && this.#renderedItems.size > 0) {
            return;
        }

        if (this.#displayedItems === undefined) return;

        const div = this.itemsContainer;
        let chNum = div.children.length;
        while (chNum-- > 0) {
            const ch = div.children[chNum];

            if (ch instanceof HTMLSlotElement && ch.name.startsWith('i-')) {
                for(const x of ch.assignedElements()) x.remove();
                ch.remove();
            }
        }
        div.innerHTML = '';

        // Original non-virtualized rendering logic
        for (const item of this.#displayedItems) {
            const ctl = this.createItemContainer();
            const template = this.#getItemTemplateContent(item);
            ctl.append(template.cloneNode(true));
            ctl.model = item;

            const slotName = 'i-' + this.#slotCount++;

            ctl.slot = slotName;
            this.appendChild(ctl);

            const slot = document.createElement('slot');
            slot.name = slotName;
            div.appendChild(slot);
        }
    }

    get #itemTemplateSlot() {
        return this.shadowRoot!.querySelector('slot[name="item-template"]') as HTMLSlotElement;
    }

    get #itemContainerTemplateSlot() {
        return this.shadowRoot!.querySelector('slot[name="item-container-template"]') as HTMLSlotElement;
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
        this.#rebuildItems();
    }

    getItemToTemplateId(item: any): string {
        return (this.itemToTemplateId ?? getTypeName)(item);
    }

    #lastUsedTemplate?: HTMLTemplateElement;

    findTemplateById(id: string): HTMLTemplateElement | undefined {
        if (this.#lastUsedTemplate?.id === id) return this.#lastUsedTemplate;

        this.#lastUsedTemplate = findTemplateById(this, id);
        return this.#lastUsedTemplate;
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

    get items() {
        return this.getProperty<Iterable<any> | undefined>('items', undefined);
    }

    get itemsContainer(): HTMLElement {
        return this.shadowRoot!.querySelector('div[part="container"]')!;
    }

    onItemsChanged() {
        if (this.virtualized) {
            this.onItemsChangedVirtualized();
        } else {
            this.onItemsChangedOriginal();
        }
    }

    onItemsChangedVirtualized() {
        let items: Iterable<any> | undefined;
        try {
            items = this.items;
        }
        catch {
            items = undefined;
        }

        if (items === this.#displayedItems) return;

        if (Array.isArray(this.#displayedItems)) {
            const tracker = getTracker(this.#displayedItems);
            if (tracker !== undefined) {
                tracker[addArrayListener](this.#onArrayChanged);
            }
        }

        const div = this.itemsContainer;
        for (const slot of div.children) {
            for (const el of (slot as HTMLSlotElement).assignedElements()) el.remove();
        }
        div.innerHTML = '';

        let chNum = this.children.length;
        while (chNum-- > 0) {
            const ch = this.children[chNum];

            if (ch instanceof HTMLSlotElement && ch.name.startsWith('i-')) ch.remove();
        }

        this.#displayedItems = items;
        this.#renderedItems.clear();
        this.#deletedItems.clear();

        if (items !== undefined) {
            let count = 0;
            let index = 0;
            for (const _ of items) {
                if (count >= 100) break;
                this.#renderItemAtIndex(index, items);
                index++;
                count++;
            }
            
            const sentinelBottom = document.createElement('div');
            sentinelBottom.setAttribute('data-index', index.toString());
            sentinelBottom.setAttribute('data-sentinel', 'bottom');
            sentinelBottom.style.height = '20px';
            sentinelBottom.style.background = 'red';
            sentinelBottom.style.border = '2px dashed black';
            sentinelBottom.textContent = 'granica donja';
            sentinelBottom.style.color = 'white';
            sentinelBottom.style.textAlign = 'center';
            sentinelBottom.style.fontWeight = 'bold';
            sentinelBottom.style.padding = '2px';
            sentinelBottom.style.margin = '5px 0';

            const sentinelTop = document.createElement('div');
            sentinelTop.setAttribute('data-index', 'top');
            sentinelTop.setAttribute('data-sentinel', 'top');
            sentinelTop.style.height = '20px';
            sentinelTop.style.background = 'blue';
            sentinelTop.style.border = '2px dashed black';
            sentinelTop.textContent = 'granica gornja';
            sentinelTop.style.color = 'white';
            sentinelTop.style.textAlign = 'center';
            sentinelTop.style.fontWeight = 'bold';
            sentinelTop.style.padding = '2px';
            sentinelTop.style.margin = '5px 0';

            if (div.firstChild) {
                div.insertBefore(sentinelTop, div.firstChild);
            } else {
                div.appendChild(sentinelTop);
            }
            div.appendChild(sentinelBottom);


            this.#intersectionObserverBottom?.disconnect();
            this.#intersectionObserverBottom = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    const target = entry.target;
                    const index = parseInt(target.getAttribute('data-index') || '');
                    
                    if (entry.isIntersecting) {
                        if (this.#itemWasRecentlyDeleted) {
                            const newIndex = index + 1;
                            target.setAttribute('data-index', newIndex.toString());
                            console.log(`Bottom sentinel incremented: index ${index} → ${newIndex}`);
                            this.#intersectionObserverBottom?.unobserve(target);
                            this.#intersectionObserverBottom?.observe(target);
                            this.#itemWasRecentlyDeleted = false; // Reset the trigger
                            this.#renderItemAtIndex(newIndex, items);
                        } else {
                            this.#renderItemAtIndex(index, items);
                        }
                    }
                    else if(!entry.isIntersecting) {
                        this.#removeItemAtIndex(index, items);
                        console.log(index);
                        entry.target.setAttribute('data-index', (index - 1).toString());
                        console.log(`Bottom sentinel updated: index ${index} → ${index - 1}`);
                        this.#itemWasRecentlyDeleted = true; // Set the trigger
                        this.#intersectionObserverBottom?.unobserve(entry.target);
                        this.#intersectionObserverBottom?.observe(entry.target);
                    }
                }
            }, {
                rootMargin: '200px 0px'
            });
            
            this.#intersectionObserverBottom.observe(sentinelBottom);
        }
    }
    
    onItemsChangedOriginal() {
        let items: Iterable<any> | undefined;
        try {
            items = this.items;
        }
        catch {
            items = undefined;
        }

        if (items === this.#displayedItems) return;

        if (Array.isArray(this.#displayedItems)) {
            const tracker = getTracker(this.#displayedItems);
            if (tracker !== undefined) {
                tracker[addArrayListener](this.#onArrayChanged);
            }
        }

        const div = this.itemsContainer;
        for (const slot of div.children) {
            for (const el of (slot as HTMLSlotElement).assignedElements()) el.remove();
        }
        div.innerHTML = '';

        let chNum = this.children.length;
        while (chNum-- > 0) {
            const ch = this.children[chNum];

            if (ch instanceof HTMLSlotElement && ch.name.startsWith('i-')) ch.remove();
        }

        this.#displayedItems = items;

        if (items !== undefined) {
            if (Array.isArray(this.#displayedItems)) {
                const tracker = getTracker(this.#displayedItems);
                if (tracker !== undefined) {
                    tracker[addArrayListener](this.#onArrayChanged);
                }
            }

            for (const item of items) {
                const ctl = this.createItemContainer();
                const template = this.#getItemTemplateContent(item);
                ctl.append(template.cloneNode(true));
                ctl.model = item; // safe as we are descendant of BindableControl so if we are created then so is BindalbeControl

                const slotName = 'i-' + this.#slotCount++;

                ctl.slot = slotName;
                this.appendChild(ctl);

                const slot = document.createElement('slot');
                slot.name = slotName;
                div.appendChild(slot);
            }
        }
    }

    #onArrayChanged = (arr: any[], index: number, inserted: number, deleted: number) => {
        const div = this.itemsContainer;

        let same = Math.min(inserted, deleted);
        inserted -= same;
        deleted -= same;

        while(same-- > 0) {
            const item = arr[index];
            const ctl = (div.children[index++] as HTMLSlotElement).assignedElements()[0] as BindableControl;
            const prevItem = ctl.model;

            if (prevItem === item) continue;

            if (this.getItemToTemplateId(item) !== this.getItemToTemplateId(prevItem)) {
                ctl.innerHTML = '';
                ctl.append(this.#getItemTemplateContent(item).cloneNode(true));
            }

            ctl.model = item;
        }

        while(inserted-- > 0) {
            const item = arr[index];

            const ctl = this.createItemContainer();
            const template = this.#getItemTemplateContent(item);
            ctl.append(template.cloneNode(true));
            ctl.model = item; // safe as we are descendant of BindableControl so if we are created then so is BindalbeControl

            const slotName = 'i-' + this.#slotCount++;

            ctl.slot = slotName;
            this.appendChild(ctl);

            const slot = document.createElement('slot');
            slot.name = slotName;

            if (index < div.childElementCount) {
                div.insertBefore(slot, div.children[index]);
            }
            else {
                div.appendChild(slot);
            }

            ++index;
        }

        while(deleted > 0) {
            const slot = div.children[index + --deleted] as HTMLSlotElement;
            for (const assigned of slot.assignedElements()) assigned.remove();
            slot.remove();
        }
    };

    override onDisconnectedFromDom(): void {
        super.onDisconnectedFromDom();
        this.onItemsChanged();
        this.#lastUsedTemplate = undefined;
        this.#itemContainerTemplate = undefined;
    }

    #itemContainerTemplate?: HTMLTemplateElement;

    createItemContainer(): BindableControl {
        if(this.#itemContainerTemplate === undefined) {
            const template = this.#itemContainerTemplateSlot.assignedElements()[0];
            this.#itemContainerTemplate = template instanceof HTMLTemplateElement ? template : undefined;
        }

        if (this.#itemContainerTemplate !== undefined) {
            const ch = this.#itemContainerTemplate.content.firstElementChild;
            if (ch !== null) {
                const maybe = document.importNode(ch, true);
                if (maybe instanceof BindableControl) return maybe;
            }
        }
        
        return document.createElement('model-control') as BindableControl;
    }

    override onAncestorsChanged(): void {
        this.#lastUsedTemplate = undefined;
    }

    get virtualized(): boolean | undefined {
        return this.getProperty('virtualized', this.#virtualized);
    }

    set virtualized(value: boolean) {
        const prev = this.#virtualized;
        this.#virtualized = value;
        this.notifyPropertySetExplicitly('virtualized', prev, value);
    }

    static override get observedAttributes() {
        return ['virtualized'];
    }

    override attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        super.attributeChangedCallback(name, oldValue, newValue);
        if (name === 'virtualized') {
            this.virtualized = newValue !== null;
        }
    }

    #renderItemAtIndex(index: number, items: Iterable<any>) {
        if (this.#renderedItems.has(index)) return;

        let currentIndex = 0;
        let targetItem;
        for (const item of items) {
            if (currentIndex === index) {
                targetItem = item;
                break;
            }
            currentIndex++;
        }
        if (targetItem === undefined) return;

        const ctl = this.createItemContainer();
        const template = this.#getItemTemplateContent(targetItem);
        ctl.append(template.cloneNode(true));
        ctl.model = targetItem;

        const slotName = 'i-' + this.#slotCount++;
        ctl.slot = slotName;
        this.appendChild(ctl);

        const slot = document.createElement('slot');
        slot.name = slotName;
        slot.setAttribute('data-item-index', index.toString());
        
        const sentinel = this.itemsContainer.querySelector(`[data-index="${index}"]`);
        if (sentinel) {
            sentinel.before(slot);
            sentinel.setAttribute('data-index', (index + 1).toString());
            this.#intersectionObserverBottom?.unobserve(sentinel);
            this.#intersectionObserverBottom?.observe(sentinel);
        } else {
            this.itemsContainer.appendChild(slot);
        }

        this.#renderedItems.add(index);
        this.#deletedItems.delete(index);
    }

    #removeItemAtIndex(index: number, items: Iterable<any>) {
        if (!this.#renderedItems.has(index)) return;
        
        let currentIndex = 0;
        let targetItem;
        for (const item of items) {
            if (currentIndex === index) {
                targetItem = item;
                break;
            }
            currentIndex++;
        }
        if (targetItem === undefined) return;
    
        const slots = this.itemsContainer.querySelectorAll('slot[name^="i-"]');
        
        for (const slot of slots) {
            const elements = (slot as HTMLSlotElement).assignedElements();
            if (elements.length === 0) continue;
            
            if ((elements[0] as any).model === targetItem) {
                elements[0].remove();
                slot.remove();
                this.#renderedItems.delete(index);
                this.#deletedItems.add(index);
                this.#itemWasRecentlyDeleted = true; // Also set the trigger here
                
                return;
            }
        }
    }
}