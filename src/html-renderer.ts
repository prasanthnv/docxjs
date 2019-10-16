import { Document } from './document';
import { IDomStyle, DomType, IDomTable, IDomStyleValues, IDomNumbering, IDomRun, 
    IDomHyperlink, IDomImage, OpenXmlElement, IDomTableColumn, IDomTableCell } from './dom/dom';
import { Length, CommonProperties } from './dom/common';
import { Options } from './docx-preview';
import { DocumentElement, SectionProperties } from './dom/document';
import { ParagraphElement } from './dom/paragraph';

export class HtmlRenderer {

    inWrapper: boolean = true;
    className: string = "docx";
    document: Document;
    options: Options;

    private digitTest = /^[0-9]/.test;

    constructor(public htmlDocument: HTMLDocument) {
    }

    render(document: Document, bodyContainer: HTMLElement, styleContainer: HTMLElement = null, options: Options) {
        this.document = document;
        this.options = options;

        styleContainer = styleContainer || bodyContainer;

        removeAllElements(styleContainer);
        removeAllElements(bodyContainer);

        appendComment(styleContainer, "docxjs library predefined styles");
        styleContainer.appendChild(this.renderDefaultStyle());
        appendComment(styleContainer, "docx document styles");
        styleContainer.appendChild(this.renderStyles(document.styles));

        if (document.numbering) {
            appendComment(styleContainer, "docx document numbering styles");
            styleContainer.appendChild(this.renderNumbering(document.numbering, styleContainer));
        }

        if(!options.ignoreFonts)
            this.renderFontTable(document.fontTable, styleContainer);

        var sectionElements = this.renderSections(document.document);

        if (this.inWrapper) {
            var wrapper = this.renderWrapper();
            appentElements(wrapper, sectionElements);
            bodyContainer.appendChild(wrapper);
        }
        else {
            appentElements(bodyContainer, sectionElements);
        }
    }

    renderFontTable(fonts: any[], styleContainer: HTMLElement) {
        for(let f of fonts.filter(x => x.refId)) {
            this.document.loadFont(f.refId, f.fontKey).then(fontData => {
                var cssTest = `@font-face {
                    font-family: "${f.name}";
                    src: url(${fontData});
                }`;

                appendComment(styleContainer, `Font ${f.name}`);
                styleContainer.appendChild(createStyleElement(cssTest));
            });
        }
    }

    processClassName(className: string) {
        if (!className)
            return this.className;

        return `${this.className}_${className}`;
    }

    processStyles(styles: IDomStyle[]) {
        var stylesMap: Record<string, IDomStyle> = {};

        for (let style of styles.filter(x => x.id != null)) {
            stylesMap[style.id] = style;
        }

        for (let style of styles.filter(x => x.basedOn)) {
            var baseStyle = stylesMap[style.basedOn];

            if (baseStyle) {
                for (let styleValues of style.styles) {
                    var baseValues = baseStyle.styles.filter(x => x.target == styleValues.target);

                    if (baseValues && baseValues.length > 0)
                        this.copyStyleProperties(baseValues[0].values, styleValues.values);
                }
            }
            else if (this.options.debug)
                console.warn(`Can't find base style ${style.basedOn}`);
        }

        for (let style of styles) {
            style.id = this.processClassName(style.id);
        }

        return stylesMap;
    }

    processElement(element: OpenXmlElement) {
        if (element.children) {
            for (var e of element.children) {
                e.className = this.processClassName(e.className);

                if (e.domType == DomType.Table) {
                    this.processTable(e);
                }
                else {
                    this.processElement(e);
                }
            }
        }
    }

    processTable(table: IDomTable) {
        for (var r of table.children) {
            for (var c of r.children) {
                c.style = this.copyStyleProperties(table.cellStyle, c.style, [
                    "border-left", "border-right", "border-top", "border-bottom",
                    "padding-left", "padding-right", "padding-top", "padding-bottom"
                ]);

                this.processElement(c);
            }
        }
    }

    copyStyleProperties(input: IDomStyleValues, output: IDomStyleValues, attrs: string[] = null): IDomStyleValues {
        if (!input)
            return output;

        if (output == null) output = {};
        if (attrs == null) attrs = Object.getOwnPropertyNames(input);

        for (var key of attrs) {
            if (input.hasOwnProperty(key) && !output.hasOwnProperty(key))
                output[key] = input[key];
        }

        return output;
    }

    createSection(className: string, props: SectionProperties) {
        var elem = this.htmlDocument.createElement("section");
        
        elem.className = className;

        if (props) {
            if (props.pageMargins) {
                elem.style.paddingLeft = this.renderLength(props.pageMargins.left);
                elem.style.paddingRight = this.renderLength(props.pageMargins.right);
                elem.style.paddingTop = this.renderLength(props.pageMargins.top);
                elem.style.paddingBottom = this.renderLength(props.pageMargins.bottom);
            }

            if (props.pageSize) {
                if (!this.options.ignoreWidth)
                    elem.style.width = this.renderLength(props.pageSize.width);
                if (!this.options.ignoreHeight)
                    elem.style.minHeight = this.renderLength(props.pageSize.height);
            }

            if (props.columns && props.columns.numberOfColumns) {
                elem.style.columnCount = `${props.columns.numberOfColumns}`;
                elem.style.columnGap = this.renderLength(props.columns.space);

                if (props.columns.separator) {
                    elem.style.columnRule = "1px solid black";
                }
            }
        }

        return elem;
    }

    renderSections(document: DocumentElement): HTMLElement[] {
        var result = [];

        this.processElement(document);

        for(let section of this.splitBySection(document.children)) {
            var sectionElement = this.createSection(this.className, section.sectProps || document.props);
            this.renderElements(section.elements, document, sectionElement);
            result.push(sectionElement);
        }

        return result;
    }

    splitBySection(elements: OpenXmlElement[]): { sectProps: SectionProperties, elements: OpenXmlElement[] }[] {
        var current = { sectProps: null, elements: [] };
        var result = [current];

        for(let elem of elements) {
            current.elements.push(elem);

            if(elem.domType == DomType.Paragraph)
            {
                const p = elem as ParagraphElement;
                var sectProps = p.props.sectionProps;
                var breakIndex = this.options.breakPages ? (p.children && p.children.findIndex(x => (<any>x).break == "page")) : -1;
    
                if(sectProps || breakIndex != -1) {
                    current.sectProps = sectProps;
                    current = { sectProps: null, elements: [] };
                    result.push(current);
                }

                if(breakIndex != -1 && breakIndex < p.children.length - 1) {
                    var children = elem.children;
                    var newParagraph = { ...elem, children: children.slice(breakIndex) };
                    elem.children = children.slice(0, breakIndex);
                    current.elements.push(newParagraph);
                }
            }
        }

        return result;
    }

    renderLength(l: Length): string {
        return !l ? null : `${l.value}${l.type}`;
    }

    renderWrapper() {
        var wrapper = document.createElement("div");

        wrapper.className = `${this.className}-wrapper`

        return wrapper;
    }

    renderDefaultStyle() {
        var styleText = `.${this.className}-wrapper { background: gray; padding: 30px; padding-bottom: 0px; display: flex; flex-flow: column; align-items: center; } 
                .${this.className}-wrapper section.${this.className} { background: white; box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); margin-bottom: 30px; }
                .${this.className} { color: black; }
                section.${this.className} { box-sizing: border-box; }
                .${this.className} table { border-collapse: collapse; }
                .${this.className} table td, .${this.className} table th { vertical-align: top; }
                .${this.className} p { margin: 0pt; }`;

        return createStyleElement(styleText);
    }

    renderNumbering(styles: IDomNumbering[], styleContainer: HTMLElement) {
        var styleText = "";
        var rootCounters = [];

        for (var num of styles) {
            var selector = `p.${this.numberingClass(num.id, num.level)}`;
            var listStyleType = "none";

            if (num.levelText && num.format == "decimal") {
                let counter = this.numberingCounter(num.id, num.level);

                if (num.level > 0) {
                    styleText += this.styleToString(`p.${this.numberingClass(num.id, num.level - 1)}`, {
                        "counter-reset": counter
                    });
                }
                else {
                    rootCounters.push(counter);
                }

                styleText += this.styleToString(`${selector}:before`, {
                    "content": this.levelTextToContent(num.levelText, num.id),
                    "counter-increment": counter
                });

                styleText += this.styleToString(selector, {
                    "display": "list-item",
                    "list-style-position": "inside",
                    "list-style-type": "none",
                    ...num.style
                });
            }
            else if (num.bullet) {
                let valiable = `--${this.className}-${num.bullet.src}`.toLowerCase();

                styleText += this.styleToString(`${selector}:before`, {
                    "content": "' '",
                    "display": "inline-block",
                    "background": `var(${valiable})`
                }, num.bullet.style);

                this.document.loadNumberingImage(num.bullet.src).then(data => {
                    var text = `.${this.className}-wrapper { ${valiable}: url(${data}) }`;
                    styleContainer.appendChild(createStyleElement(text));
                });
            }
            else {
                listStyleType = this.numFormatToCssValue(num.format);
            }

            styleText += this.styleToString(selector, {
                "display": "list-item",
                "list-style-position": "inside",
                "list-style-type": listStyleType,
                ...num.style
            });
        }

        if (rootCounters.length > 0) {
            styleText += this.styleToString(`.${this.className}-wrapper`, {
                "counter-reset": rootCounters.join(" ")
            });
        }

        return createStyleElement(styleText);
    }

    renderStyles(styles: IDomStyle[]): HTMLElement {
        var styleText = "";
        var stylesMap = this.processStyles(styles);

        for (let style of styles) {
            var subStyles =  style.styles;

            if(style.linked) {
                var linkedStyle = style.linked && stylesMap[style.linked];

                if (linkedStyle)
                    subStyles = subStyles.concat(linkedStyle.styles);
                else if(this.options.debug)
                    console.warn(`Can't find linked style ${style.linked}`);
            }

            for (var subStyle of subStyles) {
                var selector = "";

                if (style.target == subStyle.target)
                    selector += `${style.target}.${style.id}`;
                else if (style.target)
                    selector += `${style.target}.${style.id} ${subStyle.target}`;
                else
                    selector += `.${style.id} ${subStyle.target}`;

                if (style.isDefault && style.target)
                    selector = `.${this.className} ${style.target}, ` + selector;

                styleText += this.styleToString(selector, subStyle.values);
            }
        }

        return createStyleElement(styleText);
    }

    renderElement(elem: OpenXmlElement, parent: OpenXmlElement): HTMLElement {
        switch (elem.domType) {
            case DomType.Paragraph:
                return this.renderParagraph(<ParagraphElement>elem);

            case DomType.Run:
                return this.renderRun(<IDomRun>elem);

            case DomType.Table:
                return this.renderTable(elem);

            case DomType.Row:
                return this.renderTableRow(elem);

            case DomType.Cell:
                return this.renderTableCell(elem);

            case DomType.Hyperlink:
                return this.renderHyperlink(elem);

            case DomType.Drawing:
                return this.renderDrawing(<IDomImage>elem);

            case DomType.Image:
                return this.renderImage(<IDomImage>elem);
        }

        return null;
    }

    renderChildren(elem: OpenXmlElement, into?: HTMLElement): HTMLElement[] {
        return this.renderElements(elem.children, elem, into);
    }

    renderElements(elems: OpenXmlElement[], parent: OpenXmlElement, into?: HTMLElement): HTMLElement[] {
        if(elems == null)
            return null;

        var result = elems.map(e => this.renderElement(e, parent)).filter(e => e != null);

        if(into)
            for(let c of result)
                into.appendChild(c);

        return result;
    }

    renderParagraph(elem: ParagraphElement) {
        var result = this.htmlDocument.createElement("p");

        this.renderClass(elem, result);
        this.renderChildren(elem, result);
        this.renderStyleValues(elem.style, result);

        this.renderCommonProeprties(result, elem.props);

        if (elem.numberingId && elem.numberingLevel != null) {
            result.className = `${result.className} ${this.numberingClass(elem.numberingId, elem.numberingLevel)}`;
        }

        return result;
    }

    renderCommonProeprties(elem: HTMLElement, props: CommonProperties){
        if(props == null)
            return;

        if(props.color) {
            elem.style.color = props.color;
        }

        if (props.fontSize) {
            elem.style.fontSize = this.renderLength(props.fontSize);
        }
    }

    renderHyperlink(elem: IDomHyperlink) {
        var result = this.htmlDocument.createElement("a");

        this.renderChildren(elem, result);
        this.renderStyleValues(elem.style, result);

        if (elem.href)
            result.href = elem.href

        return result;
    }

    renderDrawing(elem: IDomImage) {
        var result = this.htmlDocument.createElement("div");

        result.style.display = "inline-block";
        result.style.position = "relative";
        result.style.textIndent = "0px";

        this.renderChildren(elem, result);
        this.renderStyleValues(elem.style, result);

        return result;
    }

    renderImage(elem: IDomImage) {
        let result = this.htmlDocument.createElement("img");

        this.renderStyleValues(elem.style, result);

        if (this.document) {
            this.document.loadDocumentImage(elem.src).then(x => {
                result.src = x;
            });
        }

        return result;
    }

    renderRun(elem: IDomRun) {
        if (elem.break)
            return elem.break == "page" ? null : this.htmlDocument.createElement("br");

        var result = this.htmlDocument.createElement("span");

        if (elem.text)
            result.textContent = elem.text;

        this.renderClass(elem, result);
        this.renderChildren(elem, result);
        this.renderStyleValues(elem.style, result);

        if (elem.id) {
            result.id = elem.id;
        }

        if (elem.tab) {
            //TODO
            // result.style.display = "inline-block";

            // var paragraph = <IDomParagraph>elem.parent;

            // while (paragraph != null && paragraph.domType != DomType.Paragraph)
            //     paragraph = <IDomParagraph>paragraph.parent;

            // if (paragraph && paragraph.tabs) {
            //     var tab = paragraph.tabs[0];

            //     result.style.width = tab.position;

            //     switch (tab.leader) {
            //         case "dot":
            //         case "middleDot":
            //             result.style.borderBottom = "1px black dotted";
            //             break;

            //         case "hyphen":
            //         case "heavy":
            //         case "underscore":
            //             result.style.borderBottom = "1px black solid";
            //             break;
            //     }
            // }
        }
        else if (elem.href) {
            var link = this.htmlDocument.createElement("a");

            link.href = elem.href;
            link.appendChild(result);

            return link;
        }
        else if (elem.wrapper) {
            var wrapper = this.htmlDocument.createElement(elem.wrapper);
            wrapper.appendChild(result);
            return wrapper;
        }

        return result;
    }

    renderTable(elem: IDomTable) {
        let result = this.htmlDocument.createElement("table");

        this.renderClass(elem, result);
        this.renderChildren(elem, result);
        this.renderStyleValues(elem.style, result);

        if (elem.columns)
            result.appendChild(this.renderTableColumns(elem.columns));

        return result;
    }

    renderTableColumns(columns: IDomTableColumn[]) {
        let result = this.htmlDocument.createElement("colGroup");

        for (let col of columns) {
            let colElem = this.htmlDocument.createElement("col");

            if (col.width)
                colElem.style.width = `${col.width}px`;

            result.appendChild(colElem);
        }

        return result;
    }

    renderTableRow(elem: OpenXmlElement) {
        let result = this.htmlDocument.createElement("tr");

        this.renderClass(elem, result);
        this.renderChildren(elem, result);
        this.renderStyleValues(elem.style, result);

        return result;
    }

    renderTableCell(elem: IDomTableCell) {
        let result = this.htmlDocument.createElement("td");

        this.renderClass(elem, result);
        this.renderChildren(elem, result);
        this.renderStyleValues(elem.style, result);

        if (elem.span) result.colSpan = elem.span;

        return result;
    }

    renderStyleValues(style: IDomStyleValues, ouput: HTMLElement) {
        if (style == null)
            return;

        for (let key in style) {
            if (style.hasOwnProperty(key)) {
                ouput.style[key] = style[key];
            }
        }
    }

    renderClass(input: OpenXmlElement, ouput: HTMLElement) {
        if (input.className)
            ouput.className = input.className;
    }

    numberingClass(id, lvl) {
        return `${this.className}-num-${id}-${lvl}`;
    }

    styleToString(selectors: string, values: IDomStyleValues, cssText: string = null) {
        let result = selectors + " {\r\n";

        for (const key in values) {
            result += `  ${key}: ${values[key]};\r\n`;
        }

        if (cssText)
            result += ";" + cssText;

        return result + "}\r\n";
    }

    numberingCounter(id, lvl) {
        return `${this.className}-num-${id}-${lvl}`;
    }

    levelTextToContent(text: string, id: string) {
        var result = text.replace(/%\d*/g, s => {
            let lvl = parseInt(s.substring(1), 10) - 1;
            return `"counter(${this.numberingCounter(id, lvl)})"`;
        });

        return '"' + result + '"';
    }

    numFormatToCssValue(format: string) {
        var mapping = {
            "none": "none",
            "bullet": "disc",
            "decimal": "decimal",
            "lowerLetter": "lower-alpha",
            "upperLetter": "upper-alpha",
            "lowerRoman": "lower-roman",
            "upperRoman": "upper-roman",
        };

        return mapping[format] || format;
    }
}

function appentElements(container: HTMLElement, children: HTMLElement[]) {
    for (let c of children)
        container.appendChild(c);
}

function removeAllElements(elem: HTMLElement) {
    while (elem.firstChild) {
        elem.removeChild(elem.firstChild);
    }
}

function createStyleElement(cssText: string) {
    var styleElement = document.createElement("style");
    styleElement.type = "text/css";
    styleElement.innerHTML = cssText;
    return styleElement;
}

function appendComment(elem: HTMLElement, comment: string) {
    elem.appendChild(document.createComment(comment));
}