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
    //items for virtualization
    #virtualized: boolean = false;
    #scrollTop: number = 0;
    #itemHeight: number = 0;
    #estimatedTotalHeight: number = 0;
    #windowHeight: number = 0;
    #startIndex: number = 0;
    #endIndex: number = 0;
    #visibleItems: number = 0;
    #spacerElement: HTMLElement | null = null;
    #scrollAnimationFrame: number | null = null;
    #lastHeightUpdateTime: number | null = null;

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
    #onScroll = (event: Event) => {
        const scrollContainer = event.target as HTMLElement;
        this.#scrollTop = scrollContainer.scrollTop;
        
        if (!this.#scrollAnimationFrame) {
            this.#scrollAnimationFrame = requestAnimationFrame(() => {
                this.#scrollAnimationFrame = null;
                
                // uspori updatovanje visine itema(popravi algoritam estimateItemHeight)
                if (!this.#lastHeightUpdateTime || (Date.now() - this.#lastHeightUpdateTime > 500)) {
                    this.#estimateItemHeight();
                    this.#lastHeightUpdateTime = Date.now();
                }
                
                
                const newStartIndex = Math.floor(this.#scrollTop / this.#itemHeight);
                
                if (Math.abs(newStartIndex - this.#startIndex) >= 1) {
                    this.#startIndex = newStartIndex;
                    this.#visibleItems = Math.ceil(this.#windowHeight / this.#itemHeight);
                    this.#endIndex = this.#startIndex + this.#visibleItems;
                    
                    if (this.#displayedItems) {
                        const itemsArray = Array.isArray(this.#displayedItems) ? 
                            this.#displayedItems : Array.from(this.#displayedItems);
                        this.#renderVisibleItems(itemsArray);
                    }
                }
            });
        }
    };
    #setupVirtualization() {
        this.itemsContainer.removeEventListener('scroll', this.#onScroll);
        this.itemsContainer.addEventListener('scroll', this.#onScroll, { passive: true });

        this.itemsContainer.style.overflow = 'auto';
        this.itemsContainer.style.height = '600px';
        this.itemsContainer.style.position = 'relative';

        let items: any[] = [];
        try {
            const itemsIterable = this.items;
            if (itemsIterable) {
                items = Array.isArray(itemsIterable) ? itemsIterable : Array.from(itemsIterable);
            }
        } catch {
            
        }
        
        if (items.length > 0) {
            const div = this.itemsContainer;
            div.innerHTML = '';
            this.querySelectorAll('[slot^="i-"]').forEach(el => el.remove());
            
            const sampleSize: number = Math.min(100, items.length);
            
            for (let i = 0; i < sampleSize; i++) {
                const item = items[i];
                
                const ctl: BindableControl = this.createItemContainer();
                const template = this.#getItemTemplateContent(item);
                ctl.append(template.cloneNode(true));
                ctl.model = item;

                const slotName: string = 'i-' + this.#slotCount++;

                ctl.slot = slotName;
                this.appendChild(ctl);

                const slot = document.createElement('slot');
                slot.name = slotName;
                div.appendChild(slot);
            }
            
            div.offsetHeight;
            this.#estimateItemHeight();

            div.innerHTML = '';
            this.querySelectorAll('[slot^="i-"]').forEach(el => el.remove());
        }
        this.#windowHeight = this.itemsContainer.clientHeight;
        this.#startIndex = Math.floor(this.#scrollTop / this.#itemHeight);
        this.#visibleItems = Math.ceil(this.#windowHeight / this.#itemHeight);
        this.#endIndex = this.#startIndex + this.#visibleItems;
    }

    #estimateItemHeight() {
        const visibleItems = this.querySelectorAll('[slot^="i-"]');
        if (visibleItems.length === 0) return this.#itemHeight;
        
        let count: number = 0;
        let currentMeasuredHeight: number = 0;
        
        visibleItems.forEach(item => {
            const height = (item as HTMLElement).offsetHeight;
            if (height > 0) {
                currentMeasuredHeight += height;
                count++;
            }
        });
        
        if (count === 0) return this.#itemHeight;
        const currentAverage: number = currentMeasuredHeight / count;
        
        const previousWeight: number = this.#itemHeight > 0 ? 0.7 : 0;
        const newWeight: number = 1 - previousWeight;
        this.#itemHeight = (this.#itemHeight * previousWeight) + (currentAverage * newWeight);
        
        return this.#itemHeight;
    }
    onItemsChangedVirtualized() {
        if (!this.#virtualized) return;
        
        this.#setupVirtualization();

        let items: Iterable<any> | undefined;
        try {
            items = this.items;
        } catch {
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
        div.innerHTML = '';
        
        // Create spacer element if it doesn't exist
        if (!this.#spacerElement) {
            this.#spacerElement = document.createElement('div');
            this.#spacerElement.className = 'virtual-spacer';
            this.#spacerElement.style.width = '1px';
            this.#spacerElement.style.visibility = 'hidden';
            this.#spacerElement.style.position = 'absolute';
            this.#spacerElement.style.left = '0';
            this.#spacerElement.style.pointerEvents = 'none';
            div.appendChild(this.#spacerElement);
        }
        
        this.#displayedItems = items;
        
        if (items !== undefined) {
            if (Array.isArray(this.#displayedItems)) {
                const tracker = getTracker(this.#displayedItems);
                if (tracker !== undefined) {
                    tracker[addArrayListener](this.#onArrayChanged);
                }
            }
            
            const itemsArray = Array.isArray(items) ? items : Array.from(items);
            this.#renderVisibleItems(itemsArray);
        }
    }

    #renderVisibleItems(items: any[]) {
        const scrollContainer: HTMLElement = this.itemsContainer;
        
        if (!scrollContainer.style.height) {
            scrollContainer.style.height = '600px';
        }
        scrollContainer.style.overflow = 'auto';
        scrollContainer.style.position = 'relative';
        
        // Remove flex layout which can interfere with natural element flow
        scrollContainer.style.display = 'block';
        
        this.#estimatedTotalHeight = items.length * this.#itemHeight;
        
        // We don't need the spacer element anymore as we'll use padding
        if (this.#spacerElement) {
            this.#spacerElement.remove();
            this.#spacerElement = null;
        }
        
        console.log('Total items:', items.length);
        console.log('Item height:', this.#itemHeight);
        console.log('Total virtual height:', this.#estimatedTotalHeight);
        console.log('Scroll container height:', scrollContainer.offsetHeight);
        
        const overscan: number = 5;
        const startWithOverscan: number = Math.max(0, this.#startIndex - overscan);
        const endWithOverscan: number = Math.min(items.length, this.#endIndex + overscan);
        
        const shouldBeVisible: Set<number> = new Set<number>();//skloni ovo, oslanja se da se itemi ne menjaju
        for (let i = startWithOverscan; i < endWithOverscan; i++) {
            shouldBeVisible.add(i);
        }
        
        const currentSlots: Map<number, HTMLElement> = new Map<number, HTMLElement>();
        this.querySelectorAll('[slot^="i-"]').forEach(el => {
            const index = parseInt(el.getAttribute('slot')!.substring(2));
            currentSlots.set(index, el as HTMLElement);
        });
        
        currentSlots.forEach((el, index) => {
            if (!shouldBeVisible.has(index)) {
                el.remove();
                const slot = scrollContainer.querySelector(`slot[name="i-${index}"]`);
                if (slot) slot.remove();
            }
        });
        
        // Create an array of indices to render in the correct order
        const indicesToRender = Array.from(shouldBeVisible).sort((a, b) => a - b);
        
        // Create a container for the visible range with padding above and below
        const fragment = document.createDocumentFragment();
        let container = document.createElement('div');
        
        // Add padding at the top to represent items above the visible area
        const paddingTop = startWithOverscan * this.#itemHeight;
        container.style.paddingTop = `${paddingTop}px`;
        
        // Add padding at the bottom to represent items below the visible area
        const itemsBelow = items.length - endWithOverscan;
        const paddingBottom = itemsBelow * this.#itemHeight;
        container.style.paddingBottom = `${paddingBottom}px`;
        
        fragment.appendChild(container);
        
        for (const i of indicesToRender) {
            const item = items[i];
            const slotName = `i-${i}`;
            
            if (!currentSlots.has(i)) {
                const ctl: BindableControl = this.createItemContainer();
                const template = this.#getItemTemplateContent(item);
                ctl.append(template.cloneNode(true));
                ctl.model = item;
                ctl.slot = slotName;
                this.appendChild(ctl);
                
                const slot = document.createElement('slot');
                slot.name = slotName;
                slot.style.display = 'block';
                container.appendChild(slot);
            } else {
                const ctl = currentSlots.get(i) as BindableControl;
                if (ctl.model !== item) {
                    ctl.model = item;
                }
                
                const slot = scrollContainer.querySelector(`slot[name="${slotName}"]`);
                if (slot) {
                    container.appendChild(slot);
                }
            }
        }
        
        // Clear the container and add our fragment
        scrollContainer.innerHTML = '';
        scrollContainer.appendChild(fragment);
        
        console.log('Rendered items:', shouldBeVisible.size);
        console.log('Padding top:', paddingTop, 'Padding bottom:', paddingBottom);
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
    
    onItemsChanged() {
        if (this.#virtualized) {
            this.onItemsChangedVirtualized();
        }
        else {
            this.onItemsChangedOriginal();
        }
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
            // Convert attribute to boolean property
            this.virtualized = newValue !== null;
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
}