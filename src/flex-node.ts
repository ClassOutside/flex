import { YogaNode, Node, YogaEdge } from "yoga-layout-prebuilt"
import { fromYoga, toYoga, propertyMap } from "."

type FilterGetComputed<T, Name extends keyof T> = Name extends `getComputed${infer PropertyName}`
    ? T[Name] extends (...args: Array<any>) => number
        ? PropertyName
        : never
    : never

export type GetEdgeParams<T> = T extends (...args: infer Params) => number
    ? Params extends []
        ? []
        : [edge: YogaEdge]
    : never

export type LayoutKeys = Uncapitalize<FilterGetComputed<YogaNode, keyof YogaNode>>

type PropertyMap = typeof propertyMap

export type YogaNodeProperties = {
    [Key in keyof PropertyMap]?: PropertyMap[Key] extends { type: "enum"; enumMap: object }
        ? keyof PropertyMap[Key]["enumMap"]
        :
              | number
              | (PropertyMap[Key] extends { autoUnit: true } ? "auto" : never)
              | (PropertyMap[Key] extends {
                    percentUnit: true
                }
                    ? `${number}%`
                    : never)
} & {
    measureFunc?: YogaNode["setMeasureFunc"] extends (args: infer Param) => any ? Param : never
}

export class FlexNode {
    protected readonly node: YogaNode
    protected readonly children: Array<FlexNode> = []
    public index = 0
    private shouldBeDestroyed = false

    constructor(protected readonly precision: number) {
        this.node = Node.create()
    }

    destroy(): void {
        this.shouldBeDestroyed = true
    }

    private commitChildren(): void {
        this.children.sort((a, b) => a.index - b.index)

        let i = 0

        let oldChildNode: YogaNode | undefined
        let correctChild: FlexNode | undefined
        while ((oldChildNode = this.node.getChild(i)) != null || (correctChild = this.children[i]) != null) {
            if (oldChildNode != null && correctChild != null && yogaNodeEqual(oldChildNode, correctChild.node)) {
                //unchanged
                ++i
                continue
            }

            if (oldChildNode != null) {
                this.node.removeChild(oldChildNode)
            }

            if (correctChild != null) {
                //insert
                correctChild!.node.getParent()?.removeChild(correctChild!.node)
                this.node.insertChild(correctChild!.node, i)
                ++i
            }
        }

        this.children.forEach((child) => child.commitChildren())
        if (this.shouldBeDestroyed) {
            this.node.free()
        }
    }

    calculateLayout() {
        this.commitChildren()
        this.node.calculateLayout()
    }

    insertChild(node: FlexNode): void {
        this.children.push(node)
    }

    removeChild(node: FlexNode): void {
        const i = this.children.findIndex((n) => n === node)
        if (i != -1) {
            this.children.splice(i, 1)
        }
    }

    getComputed<Key extends LayoutKeys>(key: Key, ...params: GetEdgeParams<YogaNode[`getComputed${Capitalize<Key>}`]>) {
        const func: (...params: Array<any>) => any = this.node[`getComputed${capitalize(key)}`]
        if (func == null) {
            throw `layout value "${key}" is not exisiting`
        }
        return func.call(this.node, ...params) * this.precision
    }

    setProperty<Name extends keyof YogaNodeProperties>(name: Name, value: YogaNodeProperties[Name]): void {
        if (isNotMeasureFunc(name)) {
            const propertyInfo = propertyMap[name]
            if (propertyInfo == null) {
                throw `unkown property "${name}"`
            }
            this.callNodeFunction("set", propertyInfo, toYoga(this.precision, propertyInfo, name, value))
            return
        }
        if (value == null) {
            this.node.unsetMeasureFunc()
        } else {
            this.node.setMeasureFunc(wrapMeasureFunc(value as any, this.precision))
            this.node.markDirty()
        }
    }

    protected callNodeFunction<Prefix extends "get" | "set", Name extends keyof typeof propertyMap>(
        prefix: Prefix,
        propertyInformation: typeof propertyMap[Name],
        ...params: Array<any>
    ) {
        const func: (...params: Array<any>) => any = this.node[`${prefix}${propertyInformation.functionName}`]
        if ("edge" in propertyInformation) {
            return func.call(this.node, propertyInformation.edge, ...params)
        } else {
            return func.call(this.node, ...params)
        }
    }

    getProperty<Name extends Exclude<keyof YogaNodeProperties, "measureFunc">>(name: Name): YogaNodeProperties[Name] {
        const propertyInfo = propertyMap[name]
        if (propertyInfo == null) {
            throw `unkown property "${name}"`
        }
        return fromYoga(this.precision, propertyInfo, name, this.callNodeFunction("get", propertyInfo))
    }
}

function yogaNodeEqual(n1: YogaNode, n2: YogaNode): boolean {
    return (n1 as any)["__nbindPtr"] === (n2 as any)["__nbindPtr"]
}

function capitalize<Key extends string>(key: Key) {
    return `${key.charAt(0).toUpperCase()}${key.slice(1)}` as Capitalize<Key>
}

function isNotMeasureFunc(value: keyof YogaNodeProperties): value is Exclude<keyof YogaNodeProperties, "measureFunc"> {
    return value != "measureFunc"
}

type MeasureFunc = YogaNodeProperties["measureFunc"] extends infer Y | undefined ? Y : never

function wrapMeasureFunc(func: MeasureFunc, precision: number): MeasureFunc {
    return (width, wMode, height, hMode) => {
        const result = func(width * precision, wMode, height * precision, hMode)
        if (result == null) {
            return null
        }
        return {
            width: result.width == null ? undefined : Math.ceil(result.width / precision),
            height: result.height == null ? undefined : Math.ceil(result.height / precision),
        }
    }
}
