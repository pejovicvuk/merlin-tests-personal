import { map, sleepNoThrowAsync } from "./algorithms.js";
import { BindableControl } from "./bindable-control.js";
import { toTracked } from "./dependency-tracking.js";
import { IfElse } from "./ifelse.js";
import { ItemsControl } from "./items-control.js";

export type MenuContent = string | { text: string, children?: Iterable<MenuContent | null> };

class MenuItemSeparator {
    get isSeparator() {
        return true;
    }
}

const separator = new MenuItemSeparator();

class MenuItem {
    constructor(content: MenuContent, menuModel: MenuModel) {
        this.content = content;
        this.menuModel = menuModel;
    }

    readonly content: MenuContent;
    readonly menuModel: MenuModel;

    get children() {
        return typeof this.content === 'object' ? this.content.children : undefined;
    }

    get text() {
        return typeof this.content === 'string' ? this.content : this.content.text
    }
    
    get states() {
        const ctx = this.menuModel;
        return ctx.chosen === this ? (ctx.mouseOverChosen ? "mouse-over" : "open") : undefined;
    }

    get hasChildren() {
        return this.children !== undefined;
    }

    get isSeparator() {
        return false;
    }
}

interface MenuModel {
    chosen?: MenuItem;
    mouseOverChosen: boolean;
    items: (MenuItem | MenuItemSeparator) [];
}

const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(`
    :host { box-sizing: border-box; cursor: default; user-select: none; background-color: #e6e6e6; border: 1px solid #bbbbbb; padding: 0.25em; border-radius: 0.25em; filter: drop-shadow(0em 0.15em 0.25em #bbbbbb); }
    :host > div[part="container"] { display: grid; grid-template-columns: auto auto; }
    :host > div[part="container"] > ::slotted(*) { padding: 0.25em 0.35em; border-radius: 0.25em; display: grid; grid-column: span 2; grid-template-columns: subgrid; }
    :host > div[part="container"] > ::slotted(:state(mouse-over)) { background-color: #5992f5; color: white; }
    :host > div[part="container"] > ::slotted(:state(open)) { background-color: #cccbcb; }
    :host > div[part="container"] text-block { all: initial; }
`);

const itemStyleSheet = new CSSStyleSheet();
itemStyleSheet.replaceSync(`
    :host > ::slotted(:first-child) { grid-column: 1; padding: 0px !important; margin: 0px !important; }
    :host > ::slotted(:nth-child(2)) { grid-column: 2; padding: 0px; margin: 0px; margin-left: 2ch; display: inline-block; }
    :host > ::slotted(.separator) { grid-column: span 2; background-color: #c6c6c6; height: 1px; }
`);

export class PopupMenu extends ItemsControl {
    closed?: (x: MenuContent | undefined) => void;

    #clicked?: MenuContent;

    #signal?: AbortSignal;
    #submenuAbort?: AbortController;

    #delayedSelection?: { abort: AbortController; item: MenuItem; control: BindableControl };

    constructor() {
        super();

        this.adoptStyleSheet(styleSheet);

        this.addEventListener('toggle', () => {
            if (this.#isOpen) {
                this.#signal?.addEventListener('abort', this.#onSignalAborted);

                if (this.#signal?.aborted) this.hidePopover();
            }
            else {
                this.#signal?.removeEventListener('abort', this.#onSignalAborted);

                this.remove();
                this.closed?.(this.#clicked);
            }
        });

        this.itemsContainer.addEventListener('click', ev => {
            const mi = this.#findMenuItem(ev);
            if (mi === undefined) return;

            if (mi.menuItem.children === undefined) {
                this.#clicked = mi.menuItem.content;
                this.hidePopover();
            }
            else {
                this.#submenuAbort?.abort();
                this.#submenuAbort = new AbortController();
                this.#showSubMenu(mi.menuItem, mi.control, this.#submenuAbort.signal);
            }
        });

        this.itemsContainer.addEventListener('mousemove', ev => {
            const context = this.model as MenuModel;

            const mi = this.#findMenuItem(ev);
            if (mi === undefined) return;

            if (context.chosen === mi.menuItem) {
                context.mouseOverChosen = true;
                if (this.#delayedSelection !== undefined) {
                    this.#delayedSelection.abort.abort();
                    this.#delayedSelection = undefined;
                }
            }
            else if (context.chosen !== undefined && context.chosen.hasChildren) {
                if (this.#delayedSelection === undefined) {
                    this.#delayedSelection = { abort: new AbortController, item: mi.menuItem, control: mi.control };
                    this.#selectItemDelayedAsync(this.#delayedSelection.abort.signal);
                }
                else {
                    this.#delayedSelection.item = mi.menuItem;
                }
            }
            else {
                context.chosen = mi.menuItem;
                context.mouseOverChosen = true;

                if (mi.menuItem.hasChildren) {
                    this.#submenuAbort = new AbortController();
                    this.#showSubMenu(mi.menuItem, mi.control, this.#submenuAbort.signal);
                }
            }
        });

        this.itemsContainer.addEventListener('mouseleave', () => {
            if (this.#delayedSelection !== undefined) {
                this.#delayedSelection.abort.abort();
                this.#delayedSelection = undefined;
            }

            const context = this.model as MenuModel;
            context.mouseOverChosen = false;
            if (context.chosen !== undefined && !context.chosen.hasChildren) {
                context.chosen = undefined;
            }
        });
    }

    get clicked() {
        return this.#clicked;
    }

    get #isOpen() {
        return this.matches(':popover-open');
    }

    get signal() {
        return this.#signal;
    }

    set signal(signal: AbortSignal | undefined) {
        if (this.#isOpen) {
            this.#signal?.removeEventListener('abort', this.#onSignalAborted);
            this.#signal = signal;
            this.#signal?.addEventListener('abort', this.#onSignalAborted);

            if (this.#signal?.aborted) this.hidePopover();
        }
        else {
            this.#signal = signal;
        }
    }

    readonly #onSignalAborted = () => {
        if (this.#delayedSelection !== undefined) {
            this.#delayedSelection.abort.abort();
            this.#delayedSelection = undefined;
        }

        this.hidePopover();
    };


    async #selectItemDelayedAsync(signal: AbortSignal) {
        if (await sleepNoThrowAsync(50, signal)) {
            const context = this.model as MenuModel;
            if (this.#delayedSelection !== undefined) {
                if (this.#submenuAbort !== undefined) {
                    this.#submenuAbort.abort();
                    this.#submenuAbort = undefined;
                }

                const ctl = this.#delayedSelection.control
                context.chosen = this.#delayedSelection.item;
                context.mouseOverChosen = true;

                this.#delayedSelection = undefined;

                if (context.chosen.hasChildren) {
                    this.#submenuAbort = new AbortController();
                    this.#showSubMenu(context.chosen, ctl, this.#submenuAbort.signal);
                }
            }
        }
    }

    async #showSubMenu(parent: MenuItem, parentCtl: BindableControl, signal: AbortSignal) {
        const model = this.model as MenuModel;

        const loc = parentCtl.getBoundingClientRect();

        const offsetY = parseFloat(getComputedStyle(this).fontSize) * 0.25 + 1;

        const ret = await showContextMenuInternal(parent.children!, loc.right + window.scrollX, loc.top - offsetY + window.scrollY, Corner.TopLeft, this.shadowRoot!, signal);
        if (this.#submenuAbort?.signal === signal) {
            this.#submenuAbort = undefined;
            if (model.chosen === parent) model.chosen = undefined;
        }

        if (ret !== undefined) {
            this.#clicked = ret;
            this.hidePopover();
        }
    }

    #findMenuItem(ev: Event): { control: BindableControl; menuItem: MenuItem } | undefined {
        for (const ctl of ev.composedPath()) {
            if (ctl === this) return undefined;
            else if (ctl instanceof BindableControl && ctl.hasExplicitModel && ctl.model instanceof MenuItem) {
                return { control: ctl, menuItem: ctl.model };
            }
        }

        return undefined;
    }

    override createItemContainer(): BindableControl {
        const ret = document.createElement('if-else') as IfElse;
        ret.setAttribute('states', 'this.states');
        ret.setAttribute('condition', 'this.isSeparator');
        ret.adoptStyleSheet(itemStyleSheet);
        return ret;
    }

    override onDisconnectedFromDom(): void {
        if (this.#delayedSelection !== undefined) {
            this.#delayedSelection.abort.abort();
            this.#delayedSelection = undefined;
        }

        super.onDisconnectedFromDom();
    }
}

export enum Corner {
    TopLeft = 0, TopRight = 1, BottomLeft = 2, BottomRight = 3
}

function showContextMenuInternal(items: Iterable<MenuContent | null>, x: number, y: number, corner: Corner, owner: Node, signal?: AbortSignal): Promise<MenuContent | undefined> {
    return new Promise<MenuContent | undefined>(resolve => {
        if (signal?.aborted) {
            resolve(undefined);
            return;
        }

        const popup = document.createElement('popup-menu') as PopupMenu;
        popup.signal = signal;
        popup.innerHTML = `
            <template slot="item-template">
                <text-block slot="false" text="this.text"></text-block>
                <if-else slot="false" condition="this.hasChildren">
                    <span slot="true">&#x276F;</span>
                </if-else>

                <div class="separator" slot="true"></div>
            </template>
        `;

        popup.setAttribute('popover', 'auto');
        popup.setAttribute('items', 'this.items');

        const left = (corner.valueOf() & 1) === 0;
        const top = (corner.valueOf() & 2) === 0;

        let style = `
            position: absolute;
            margin: 0;
            ${left ? 'left: ' : 'right: '}${x}px;
            ${top ? 'top: ' : 'bottom: '}${y}px;
        `;

        popup.setAttribute('style', style);

        const menuModel = toTracked<MenuModel>({ items: null!, mouseOverChosen: false });
        const itemsArray = [...map(items, x => x === null ? separator : toTracked(new MenuItem(x, menuModel)))];
        menuModel.items = itemsArray;

        popup.model = menuModel;
        owner.appendChild(popup);
        popup.closed = menuItem => resolve(menuItem);

        popup.showPopover();
    });
}

export async function showContextMenu(items: Iterable<MenuContent | null>, x: number, y: number, corner: Corner): Promise<MenuContent | undefined> {
    const abort = new AbortController();
    const onSizeChanged = () => abort.abort();

    window.addEventListener('resize', onSizeChanged, { once: true });
    const ret = await showContextMenuInternal(items, x, y, corner, document.body, abort.signal);
    window.removeEventListener('resize', onSizeChanged);

    return ret;
}