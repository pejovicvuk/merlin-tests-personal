import { BindableControl } from "./bindable-control.js";
import { addArrayListener, getTracker, removeArrayListener } from "./dependency-tracking.js";
import { findTemplateById, getTypeName } from "./dom-utilities.js";
import { HtmlControl, HtmlControlBindableProperty } from "./html-control.js";
import { enqueTask } from "./task-queue.js";

const standardTemplate = document.createElement('template');
standardTemplate.innerHTML = '<text-block text="this"></text-block>';

const shadowHtml = '<slot name="item-template"></slot><slot name="item-container-template"><template><model-control></model-control></template></slot><div part="container"></div>';

export class ItemsControl extends HtmlControl implements HtmlControlBindableProperty<'items', Iterable<any>>, HtmlControlBindableProperty<'itemToTemplateId', (item: any) => string> {
    static override bindableProperties = [...HtmlControl.bindableProperties, 'items', 'itemToTemplateId', 'virtualized'];

    #displayedItems?: Iterable<any>;
    #slotCount = 0;
    #itemToTemplateId?: (item: any) => string;
    #recentlyDeleted?: Map<any, BindableControl>;
    #lastUsedItemToTemplateId?: ((item: any) => string);
    #virtualized: boolean = false; 
    #itemToElementMap = new Map<any, BindableControl>();
    #estimatedTotalHeight: number = 0;
    #observer?: IntersectionObserver;
    #lastRenderedIndex: number = 0;
    #firstRenderedIndex: number = 0;
    #averageItemHeight: number = 0;
    #initialRenderCount: number = 100;
    #itemsPerViewport: number = 0;
    #currentPaddingTop: number = 0;
    #currentPaddingBottom: number = 0;

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

    #rebuildItems () {
        this.#assignedElementsCache = undefined;
        this.#itemContainerTemplate = undefined;

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

        for (const item of this.#displayedItems) {
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

    get #itemTemplateSlot() {
        return this.shadowRoot!.querySelector('slot[name="item-template"]') as HTMLSlotElement;
    }

    get #itemContainerTemplateSlot() {
        return this.shadowRoot!.querySelector('slot[name="item-container-template"]') as HTMLSlotElement;
    }

    get itemToTemplateId(): ((item: any) => string) | undefined {
        this.#lastUsedItemToTemplateId = this.getProperty('itemToTemplateId', this.#itemToTemplateId);
        return this.#lastUsedItemToTemplateId;
    }

    set itemToTemplateId(func: ((item: any) => string) | undefined) {
        const prev = this.#itemToTemplateId;
        this.#itemToTemplateId = func;
        this.notifyPropertySetExplicitly('itemToTemplateId', prev, func);
    }

    onItemToTemplateIdChanged() {
        const prev = this.#lastUsedItemToTemplateId;
        const current = this.itemToTemplateId;
        if (prev !== current) {
            this.#rebuildItems();
        }
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

    get virtualized(): boolean | undefined {
        return this.getProperty('virtualized', this.#virtualized);
    }

    set virtualized(value: boolean){
        const prev = this.#virtualized;
        this.#virtualized = value;
        this.notifyPropertySetExplicitly('virtualized', prev, value);
    }
    static override get observedAttributes() {
        return [...super.observedAttributes, 'virtualized'];
    }
    override attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        super.attributeChangedCallback(name, oldValue, newValue);
        
        if (name === 'virtualized') {
            this.virtualized = newValue !== null;
        }
    }

    onItemsChanged() {
        if (this.virtualized && Array.isArray(this.items)) {
            this.onItemsChangedVirtualized();
        } else {
            this.onItemsChangedOriginal();
        }
    }

    onItemsChangedVirtualized() {
        let items: any[] | undefined;
        try {
            items = this.items as any[];
        } catch {
            items = undefined;
        }

        const currentItems = Array.from(this.#itemToElementMap.keys()).length > 0 ? 
            this.items : undefined;
        
        if (items === currentItems) return;
        
        // remove listener from previous array
        if (Array.isArray(currentItems)) {
            const tracker = getTracker(currentItems);
            if (tracker !== undefined) {
                tracker[removeArrayListener](this.#onArrayChangedVirtualized);
            }
        }
        
        this.#itemToElementMap.clear();
        
        const div = this.itemsContainer;
        div.innerHTML = '';
        
        div.style.overflow = 'auto';
        div.style.height = this.getAttribute('height') || '60vh';
        

        if (items !== undefined) {
            if (Array.isArray(items)) {
                const tracker = getTracker(items);
                if (tracker !== undefined) {
                    tracker[addArrayListener](this.#onArrayChangedVirtualized);
                }
            }
            
            const virtualContainer = document.createElement('div');
            virtualContainer.style.display = 'flex';
            virtualContainer.style.flexDirection = 'column';
            div.appendChild(virtualContainer);

            this.#lastRenderedIndex = Math.min(items.length, this.#initialRenderCount) - 1;

            this.#observer = new IntersectionObserver((entries) => {                
                const firstElement = this.#itemToElementMap.get(items[this.#firstRenderedIndex]);
                const lastElement = this.#itemToElementMap.get(items[this.#lastRenderedIndex]);
                const virtualContainer = this.itemsContainer.firstElementChild as HTMLElement;

                let firstItemVisible: boolean = false;
                let lastItemVisible: boolean = false;

                const entryMap = new Map(entries.map(entry => [entry.target, entry]));

                if (firstElement) {
                    const firstEntry = entryMap.get(firstElement);
                    firstItemVisible = firstEntry ? firstEntry.isIntersecting : false;
                }

                if (lastElement) {
                    const lastEntry = entryMap.get(lastElement);
                    lastItemVisible = lastEntry ? lastEntry.isIntersecting : false;
                }
                
                if (firstItemVisible && this.#firstRenderedIndex > 0) {
                    console.log('First item visible, rendering items above');
                    
                    const itemsToRenderAbove = Math.min(this.#itemsPerViewport, this.#firstRenderedIndex);
                    
                    const scrollTop = this.itemsContainer.scrollTop;
                    const containerHeight = this.itemsContainer.scrollHeight;
                    
                    for (let i = 1; i <= itemsToRenderAbove; i++) {
                        const newIndex = this.#firstRenderedIndex - i;
                        const newItem = items[newIndex];
                        
                        if (this.#itemToElementMap.has(newItem)) continue;//not sure if needed
                        
                        const ctl = this.#renderItemAtIndex(newIndex, true);
                        
                        if (ctl) {
                            this.#itemToElementMap.set(newItem, ctl);
                            
                            requestAnimationFrame(() => {
                                const rect = ctl.getBoundingClientRect();
                                if (rect.height > 0) {
                                    this.#currentPaddingTop = Math.floor(parseFloat(virtualContainer.style.paddingTop || '0'));
                                    const newPadding = Math.max(0, this.#currentPaddingTop - rect.height);
                                    virtualContainer.style.paddingTop = `${newPadding}px`;
                                    
                                    //scroll adjustment to prevent jumping
                                    const heightDiff = this.itemsContainer.scrollHeight - containerHeight;
                                    if (heightDiff > 0) {
                                        this.itemsContainer.scrollTop = scrollTop + heightDiff;
                                    }
                                }
                            });
                        }
                    }
                    
                    this.#firstRenderedIndex -= itemsToRenderAbove;
                    
                    requestAnimationFrame(() => {
                        for (let i = 0; i < itemsToRenderAbove; i++) {
                            const lastItem = items[this.#lastRenderedIndex];
                            const lastElement = this.#itemToElementMap.get(lastItem);
                            
                            if (lastElement) {
                                const rect = lastElement.getBoundingClientRect();
                                
                                const slotName = lastElement.slot;
                                const slot = virtualContainer.querySelector(`slot[name="${slotName}"]`);
                                
                                this.#currentPaddingBottom = Math.floor(parseFloat(virtualContainer.style.paddingBottom || '0'));
                                const newPadding = Math.max(0, this.#currentPaddingBottom + rect.height);
                                virtualContainer.style.paddingBottom = `${newPadding}px`;
                                
                                if (slot) slot.remove();
                                this.#itemToElementMap.delete(lastItem);
                                lastElement.remove();
                                this.#lastRenderedIndex--;
                            }
                        }
                    });
                }
                
                if (lastItemVisible && this.#lastRenderedIndex < items.length - 1) {
                    
                    const itemsToRenderBelow = Math.min(this.#itemsPerViewport, items.length - 1 - this.#lastRenderedIndex);
                    
                    for (let i = 1; i <= itemsToRenderBelow; i++) {
                        const newIndex = this.#lastRenderedIndex + i;
                        const newItem = items[newIndex];
                        
                        if (this.#itemToElementMap.has(newItem)) continue;//not sure if needed
                        
                        const ctl = this.#renderItemAtIndex(newIndex);
                        
                        if (ctl) {
                            this.#itemToElementMap.set(newItem, ctl);
                            
                            requestAnimationFrame(() => {
                                const rect = ctl.getBoundingClientRect();
                                if (rect.height > 0) {
                                    this.#currentPaddingBottom = Math.floor(parseFloat(virtualContainer.style.paddingBottom || '0'));
                                    const newPadding = Math.max(0, this.#currentPaddingBottom - rect.height);
                                    virtualContainer.style.paddingBottom = `${newPadding}px`;
                                }
                            });
                        }
                    }
                    
                    this.#lastRenderedIndex += itemsToRenderBelow;
                    
                    requestAnimationFrame(() => {
                        for (let i = 0; i < itemsToRenderBelow; i++) {
                            const firstItem = items[this.#firstRenderedIndex];
                            const firstElement = this.#itemToElementMap.get(firstItem);
                            
                            if (firstElement) {
                                const rect = firstElement.getBoundingClientRect();
                                
                                const slotName = firstElement.slot;
                                const slot = virtualContainer.querySelector(`slot[name="${slotName}"]`);
                                
                                this.#currentPaddingTop = Math.floor(parseFloat(virtualContainer.style.paddingTop || '0'));
                                const newPadding = Math.max(0, this.#currentPaddingTop + rect.height);
                                virtualContainer.style.paddingTop = `${newPadding}px`;
                                
                                if (slot) slot.remove();
                                this.#itemToElementMap.delete(firstItem);
                                firstElement.remove();
                                this.#firstRenderedIndex++;
                            }
                        }
                    });
                }
                if (!firstItemVisible && !lastItemVisible && this.#isViewportEmpty()) { //not sure about this check
                    console.log('no items are visible');
                    this.#handleEmptyViewport();
                }

                if (this.#lastRenderedIndex === items.length - 1) {
                    virtualContainer.style.paddingBottom = '0px';
                    this.#currentPaddingBottom = 0;
                }

                if (this.#firstRenderedIndex === 0) {
                    virtualContainer.style.paddingTop = '0px';
                    this.#currentPaddingTop = 0;
                }
            }, {
                root: div,
                rootMargin: '100%',
                threshold: 0.0
            });
            
            for (let i = 0; i < this.#initialRenderCount && i < items.length; i++) {
                const item = items[i];
                
                const ctl = this.createItemContainer();
                const template = this.#getItemTemplateContent(item);
                ctl.append(template.cloneNode(true));
                ctl.model = item;
                
                const slotName = 'i-' + this.#slotCount++;
                ctl.slot = slotName;
                this.appendChild(ctl);
                
                const slot = document.createElement('slot');
                slot.name = slotName;
                virtualContainer.appendChild(slot);
                
                this.#itemToElementMap.set(item, ctl);
                this.#observer.observe(ctl);
            }
            requestAnimationFrame(() => { // average item height is not correct without requestAnimationFrame()
                const lastRenderedItem = items[this.#lastRenderedIndex];
                const lastElement = this.#itemToElementMap.get(lastRenderedItem);
                if (!lastElement) return;
                
                const rect = lastElement.getBoundingClientRect();
                
                const totalRenderedHeight: number = (rect.height + rect.top);
                
                this.#averageItemHeight = totalRenderedHeight / this.#initialRenderCount; //suspicious
                this.#estimatedTotalHeight = this.#averageItemHeight * items.length;
                
                virtualContainer.style.paddingTop = '0px';
                virtualContainer.style.paddingBottom = `${this.#estimatedTotalHeight - totalRenderedHeight}px`;
                const viewportHeight: number = div.clientHeight;
                this.#itemsPerViewport = Math.ceil(viewportHeight / this.#averageItemHeight);
            });
        }
    }
    #renderItemAtIndex(index: number, insertAtBeginning: boolean = false): BindableControl | null {
        const items = this.items as any[];
        if (index < 0 || index >= items.length || this.#itemToElementMap.has(items[index])) {
            return null;
        }
        
        const virtualContainer = this.itemsContainer.firstElementChild as HTMLElement;
        const item = items[index];
        
        const ctl = this.createItemContainer();
        const template = this.#getItemTemplateContent(item);
        ctl.append(template.cloneNode(true));
        ctl.model = item;
        
        const slotName = 'i-' + this.#slotCount++;
        ctl.slot = slotName;
        this.appendChild(ctl);
        
        const slot = document.createElement('slot');
        slot.name = slotName;
        
        if (insertAtBeginning) {
            virtualContainer.insertBefore(slot, virtualContainer.firstChild);
        } else {
            virtualContainer.appendChild(slot);
        }
        
        this.#itemToElementMap.set(item, ctl);
        this.#observer!.observe(ctl);
        
        return ctl;
    }
    #handleEmptyViewport(): void {
        console.log('handleEmptyViewport() called');
        const items = this.items as any[];
        
        const container = this.itemsContainer;
        const virtualContainer = container.firstElementChild as HTMLElement;
        
        for (const [_, element] of this.#itemToElementMap.entries()) {
            const slotName = element.slot;
            const slot = virtualContainer.querySelector(`slot[name="${slotName}"]`);
            if (slot) slot.remove();
            element.remove();
        }
        this.#itemToElementMap.clear();
        
        const scrollTop = container.scrollTop;
        
        const estimatedIndex = Math.floor(scrollTop / this.#averageItemHeight);
        const safeIndex = Math.max(0, Math.min(estimatedIndex, items.length - 1));

        const halfCount = Math.floor(this.#initialRenderCount / 2);
        
        const startIndex = Math.max(0, safeIndex - halfCount);
        const endIndex = Math.min(items.length - 1, safeIndex + halfCount);
        
        const paddingTop = startIndex * this.#averageItemHeight;
        virtualContainer.style.paddingTop = `${paddingTop}px`;
        
        const itemsBelow = items.length - endIndex - 1;
        const paddingBottom = itemsBelow * this.#averageItemHeight;
        virtualContainer.style.paddingBottom = `${paddingBottom}px`;
        
        for (let i = startIndex; i <= endIndex; i++) {
            const item = items[i];
            const ctl = this.#renderItemAtIndex(i);
            
            if (ctl) {
                this.#itemToElementMap.set(item, ctl);
                this.#observer!.observe(ctl);
            }
        }
        
        this.#firstRenderedIndex = startIndex;
        this.#lastRenderedIndex = endIndex;
    }
    #isViewportEmpty(): boolean {
        for (const element of this.#itemToElementMap.values()) {
            const rect = element.getBoundingClientRect();
            
            if (
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
                rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
                window.getComputedStyle(element).display !== 'none' &&
                window.getComputedStyle(element).visibility !== 'hidden' &&
                window.getComputedStyle(element).opacity !== '0'
            ) {
                return false;
            }
        }  
        return this.#itemToElementMap.size > 0;
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
                tracker[removeArrayListener](this.#onArrayChanged);
            }
        }

        const div = this.itemsContainer;

        let chNum = div.children.length;
        while (chNum-- > 0) {
            const ch = div.children[chNum];

            if (ch instanceof HTMLSlotElement && ch.name.startsWith('i-')) {
                for(const x of ch.assignedElements()) x.remove();
                ch.remove();
            }
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

    #onArrayChanged = (arr: any[], index: number, inserted: number, deleted: number, deletedItems: any | any[] | undefined) => {
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

            let ctl = this.#recentlyDeleted?.get(item);
            if (ctl === undefined) {
                ctl = this.createItemContainer();
                const template = this.#getItemTemplateContent(item);
                ctl.append(template.cloneNode(true));
            }
            else {
                this.#recentlyDeleted!.delete(item);
            }

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
            const assigned = slot.assignedElements();
            if (assigned.length !== 1) throw new Error('Unexpected state.');
            const model = assigned[0] as BindableControl;
            if (this.#recentlyDeleted === undefined) {
                this.#recentlyDeleted = new Map();
                enqueTask(ItemsControl.#clearRecentlyDeletedCallback, this);
            }
            this.#recentlyDeleted.set(model.model, model);
            model.remove();
            slot.remove();
        }
    };

    override onDisconnectedFromDom(): void {
        this.#recentlyDeleted = undefined;
        this.#itemToElementMap.clear();
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

    static #clearRecentlyDeletedCallback(ctl: ItemsControl) {
        ctl.#recentlyDeleted = undefined;
    }

    #onArrayChangedVirtualized = (arr: any[], index: number, inserted: number, deleted: number, deletedItems: any | any[] | undefined) => {
        const isAffectingRenderedRange = 
            (index <= this.#lastRenderedIndex && index >= this.#firstRenderedIndex) || 
            (index + inserted > this.#firstRenderedIndex && index < this.#lastRenderedIndex) ||
            (index + deleted > this.#firstRenderedIndex && index < this.#lastRenderedIndex);
        
        //handling changes outside of the rendered range
        if (!isAffectingRenderedRange) {
            if (index <= this.#firstRenderedIndex) {
                this.#firstRenderedIndex += inserted - deleted;
                this.#lastRenderedIndex += inserted - deleted;
                
                const virtualContainer = this.itemsContainer.firstElementChild as HTMLElement;
                if (virtualContainer) {
                    const heightDiff = (inserted - deleted) * this.#averageItemHeight;
                    this.#currentPaddingTop = Math.floor(parseFloat(virtualContainer.style.paddingTop));
                    virtualContainer.style.paddingTop = `${Math.max(0, this.#currentPaddingTop + heightDiff)}px`;
                }
            }
            return;
        }
        
        const virtualContainer = this.itemsContainer.firstElementChild as HTMLElement;

        let same = Math.min(inserted, deleted);
        inserted -= same;
        deleted -= same;
        
        while(same-- > 0) {
            if (index < this.#firstRenderedIndex || index > this.#lastRenderedIndex) {
                index++;
                continue;
            }
            
            const item = arr[index];
            const slots = virtualContainer.querySelectorAll('slot');
            const slotIndex = index - this.#firstRenderedIndex;
            
            if (slotIndex >= 0 && slotIndex < slots.length) {
                const slot = slots[slotIndex] as HTMLSlotElement;
                const assigned = slot.assignedElements();
                
                if (assigned.length === 1) {
                    const ctl = assigned[0] as BindableControl;
                    const prevItem = ctl.model;
                    
                    if (prevItem === item) {
                        index++;
                        continue;
                    }
                    
                    if (this.getItemToTemplateId(item) !== this.getItemToTemplateId(prevItem)) {
                        ctl.innerHTML = '';
                        ctl.append(this.#getItemTemplateContent(item).cloneNode(true));
                    }
                    
                    ctl.model = item;
                    this.#itemToElementMap.delete(prevItem);
                    this.#itemToElementMap.set(item, ctl);
                }
            }
            index++;
        }
        
        if (inserted > 0) {
            if (index >= this.#firstRenderedIndex && index <= this.#lastRenderedIndex + 1) {
                for (let i = 0; i < inserted; i++) {
                    const insertIndex = index + i;
                    
                    if (insertIndex > this.#lastRenderedIndex) {
                        this.#lastRenderedIndex++;
                        continue;
                    }
                    
                    const item = arr[insertIndex];
                    
                    if (this.#itemToElementMap.has(item)) continue;
                    
                    const ctl = this.createItemContainer();
                    const template = this.#getItemTemplateContent(item);
                    ctl.append(template.cloneNode(true));
                    ctl.model = item;
                    
                    const slotName = 'i-' + this.#slotCount++;
                    ctl.slot = slotName;
                    this.appendChild(ctl);
                    
                    const slot = document.createElement('slot');
                    slot.name = slotName;
                    
                    const slots = Array.from(virtualContainer.querySelectorAll('slot'));
                    const insertPosition = insertIndex - this.#firstRenderedIndex;
                    
                    if (insertPosition < slots.length && slots[insertPosition]) {
                        virtualContainer.insertBefore(slot, slots[insertPosition]);
                    } else {
                        virtualContainer.appendChild(slot);
                    }
                    
                    this.#itemToElementMap.set(item, ctl);
                    this.#observer!.observe(ctl);
                }
            } else {
                if (index < this.#firstRenderedIndex) {
                    this.#firstRenderedIndex += inserted;
                    this.#lastRenderedIndex += inserted;
                }
            }
        }
        
        if (deleted > 0) {
            for (let i = 0; i < deleted; i++) {
                const deleteIndex = index + i;
                
                if (deleteIndex >= this.#firstRenderedIndex && deleteIndex <= this.#lastRenderedIndex) {
                    const deletedItem = deletedItems instanceof Array ? deletedItems[i] : deletedItems;
                    const element = this.#itemToElementMap.get(deletedItem);
                    
                    if (element) {
                        const slotName = element.slot;
                        const slot = virtualContainer.querySelector(`slot[name="${slotName}"]`);
                        
                        if (slot) slot.remove();
                        this.#itemToElementMap.delete(deletedItem);
                        element.remove();
                    }
                }
            }
            
            this.#lastRenderedIndex -= Math.min(deleted, this.#lastRenderedIndex - this.#firstRenderedIndex + 1);
        }
        
        this.#updateVirtualPadding();
    };

    #updateVirtualPadding() {
        const items = this.items as any[];
        
        const virtualContainer = this.itemsContainer.firstElementChild as HTMLElement;
        if (!virtualContainer) return;
        
        const paddingTop = this.#firstRenderedIndex * this.#averageItemHeight;
        virtualContainer.style.paddingTop = `${paddingTop}px`;
        this.#currentPaddingTop = paddingTop;
        
        const itemsBelow = items.length - this.#lastRenderedIndex - 1;
        const paddingBottom = itemsBelow * this.#averageItemHeight;
        virtualContainer.style.paddingBottom = `${paddingBottom}px`;
        this.#currentPaddingBottom = paddingBottom;
    }
}