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
    #sentinelTop?: HTMLElement;
    #sentinelBottom?: HTMLElement;
    #topSentinelIndex: number = 0;
    #bottomSentinelIndex: number = 0;

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
        if (this.virtualized) {
            this.onItemsChangedVirtualized();
        } else {
            this.onItemsChangedOriginal();
        }
    }

    onItemsChangedVirtualized() {
        if (!Array.isArray(this.items)) {
            return this.onItemsChangedOriginal();
        }
        
        let items: any[] | undefined;
        try {
            items = this.items as any[];
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
        
        this.#itemToElementMap.clear();
        
        const div = this.itemsContainer;

        this.#displayedItems = items;

        if (items !== undefined) {
            if (Array.isArray(this.#displayedItems)) {
                const tracker = getTracker(this.#displayedItems);
                if (tracker !== undefined) {
                    tracker[addArrayListener](this.#onArrayChanged);
                }
            }

            const initialRenderCount: number = 300;
            
            for (const item of items) {
                if (this.#slotCount >= initialRenderCount) break;
                
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
                
                this.#itemToElementMap.set(item, ctl);
            }
            
            // calculating the total height of the items after they are rendered
            requestAnimationFrame(() => {
                let totalHeight: number = 0;
                
                this.#itemToElementMap.forEach((ctl) => {
                    const styles = window.getComputedStyle(ctl);
                    const marginTop = parseFloat(styles.marginTop);
                    const marginBottom = parseFloat(styles.marginBottom);
                    const rect = ctl.getBoundingClientRect();      
                    
                    if (rect.height > 0) {
                        totalHeight += rect.height + marginTop + marginBottom;
                    }
                });
                
                const averageItemHeight = totalHeight / initialRenderCount;
                this.#estimatedTotalHeight = averageItemHeight * items.length;
                
                div.style.position = 'relative';
                div.style.overflow = 'auto';
                div.style.height = '600px'; // hardcoded for testing purposes 
                
                let scrollHeightContainer = div.querySelector('.virtual-height-container') as HTMLElement;
                if (!scrollHeightContainer) {
                    scrollHeightContainer = document.createElement('div');
                    scrollHeightContainer.style.height = '1px';
                    scrollHeightContainer.style.visibility = 'hidden';
                    scrollHeightContainer.style.position = 'absolute';
                    scrollHeightContainer.style.left = '0';
                    scrollHeightContainer.style.top = '0';
                    scrollHeightContainer.style.width = '1px';
                    div.appendChild(scrollHeightContainer);
                }
                
                scrollHeightContainer.style.height = `${this.#estimatedTotalHeight}px`;
                
                console.log(`Average item height (with margins): ${averageItemHeight}px`);
                console.log(`Estimated total height for ${items.length} items: ${this.#estimatedTotalHeight}px`);
            });

            this.#sentinelBottom = document.createElement('div');
            this.#sentinelBottom.style.height = '1px';
            this.#sentinelBottom.style.visibility = 'hidden';
            this.#sentinelBottom.style.margin = '0';
            this.#sentinelBottom.style.padding = '0';

            this.#sentinelTop = document.createElement('div');
            this.#sentinelTop.style.height = '1px';
            this.#sentinelTop.style.visibility = 'hidden';
            this.#sentinelTop.style.margin = '0';
            this.#sentinelTop.style.padding = '0';

            if (div.firstChild) {
                div.insertBefore(this.#sentinelTop, div.firstChild);
            } else {
                div.appendChild(this.#sentinelTop);
            }
            div.appendChild(this.#sentinelBottom);

            this.#topSentinelIndex = 0;
            this.#bottomSentinelIndex = initialRenderCount;
            console.log(`Top sentinel index: ${this.#topSentinelIndex}`);
            console.log(`Bottom sentinel index: ${this.#bottomSentinelIndex}`);

            const observerOptions = {
                root: div,
                rootMargin: '500px 0px 500px 0px',
                threshold: 0.0
            };

            const topObserver = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    console.log("Top sentinel is visible");
                    // Will handle rendering items above here
                }
                else {
                    console.log("Top sentinel is not visible");
                }
            }, observerOptions);

            const bottomObserver = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    console.log("Bottom sentinel is visible");
                    
                    // Get the items array
                    const items = this.items as any[];
                    if (!items || this.#bottomSentinelIndex >= items.length) {
                        console.log("No more items to render below");
                        return;
                    }
                    
                    // Determine how many items to render in this batch
                    const batchSize = 100;
                    const endIndex = Math.min(items.length, this.#bottomSentinelIndex + batchSize);
                    
                    console.log(`Rendering items from index ${this.#bottomSentinelIndex} to ${endIndex - 1}`);
                    
                    // Render the next batch of items
                    for (let i = this.#bottomSentinelIndex; i < endIndex; i++) {
                        const item = items[i];
                        
                        // Create the item container
                        const ctl = this.createItemContainer();
                        const template = this.#getItemTemplateContent(item);
                        ctl.append(template.cloneNode(true));
                        ctl.model = item;
                        
                        // Set up the slot
                        const slotName = 'i-' + this.#slotCount++;
                        ctl.slot = slotName;
                        this.appendChild(ctl);
                        
                        // Create and add the slot to the container
                        const slot = document.createElement('slot');
                        slot.name = slotName;
                        
                        // Insert before the bottom sentinel
                        if (this.#sentinelBottom) {
                            div.insertBefore(slot, this.#sentinelBottom);
                        } else {
                            div.appendChild(slot);
                        }
                        
                        // Update the mapping
                        this.#itemToElementMap.set(item, ctl);
                    }
                    
                    // Update the bottom sentinel index
                    this.#bottomSentinelIndex = endIndex;
                    console.log(`Updated bottom sentinel index to ${this.#bottomSentinelIndex}`);
                }
                else {
                    console.log("Bottom sentinel is not visible");
                }
            }, observerOptions);

            topObserver.observe(this.#sentinelTop);
            bottomObserver.observe(this.#sentinelBottom);
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
}