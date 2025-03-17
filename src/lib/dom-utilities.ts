export function findTemplateById(ctl: Element, id: string): HTMLTemplateElement | undefined {
    for (;;) {
        const root = ctl.getRootNode();
        if (root instanceof ShadowRoot) {
            const maybeTemplate = root.getElementById(id);
            if (maybeTemplate instanceof HTMLTemplateElement) return maybeTemplate;
            ctl = root.host;
        }
        else if (root instanceof Document) {
            const maybeTemplate = root.getElementById(id);
            return maybeTemplate instanceof HTMLTemplateElement ? maybeTemplate : undefined;
        }
        else {
            return undefined;
        }
    }
}

export function getTypeName(item: any): string {
    const tp = typeof item;
    if (tp === 'object') {
        return Object.getPrototypeOf(item).constructor.name;
    }
    else if (tp == 'function') {
        return item.name;
    }
    else {
        return tp;
    }
}
