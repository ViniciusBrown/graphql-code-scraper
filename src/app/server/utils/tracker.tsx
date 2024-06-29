"use server"

import { parse } from "@babel/parser";
import traverse, { Node, NodePath as NodePath, Scope } from "@babel/traverse";
import {
  CallExpression,
  File,
  Identifier,
  JSXExpressionContainer,
  JSXOpeningElement,
  ObjectPattern,
  ObjectProperty,
  Program,
  ThisExpression,
  VariableDeclaration,
  VariableDeclarator,
} from "@babel/types";
import { globSync } from 'glob'
import { readFileSync, lstatSync, existsSync } from "fs"
import { Edge, type Node as FlowNode } from 'reactflow';

const trackCommentTag = "track_this_variable";
const trackVariableCommentTag = "track_variable=";

const RESERVED_MEMBER_EXPRESSIONS = new Set(['length'])
const RESERVED_ARRAY_FUNCTIONS = new Set(['map', 'flatMap', 'filter', 'forEach'])

type EventType = {
  type: "expression_reference" |
  "in_scope_reference" |
  "scope_change_reference" |
  "declaration";
  from_var: string;
  to_var: null | string;
  memberExpressionAsArray: string[];
  from_scope: string;
  to_scope: string;
  from_file: string;
  to_file: string;
  id?: string;
  from_scope_obj: ASTScope;
  to_scope_obj: ASTScope;
  context: {
    currentTrackFromMemberExpressionArray: string[];
    addToNextTrackFromMemberExpressionArray: string[];
    targetType?: string | null;
    errorMessages?: string[];
    paramPosition?: number
  };
  loadNextEvents: () => EventType[]
};

const turnArrayIntoObject = (arrayOfArrays: string[][]) => {
  const result: {[key: string]: any} = {}
  arrayOfArrays.forEach((fields) => {
    const fieldsCopy = [...fields];
    if (fieldsCopy.length > 0) {
      const firstField = fieldsCopy.shift();
      if (firstField) {
        result[firstField] = result[firstField] ? result[firstField] : {};
        let currentField = result[firstField];
        fieldsCopy.forEach((field) => {
          currentField[field] = currentField[field] ? currentField[field] : {};
          currentField = currentField[field];
        });
      }
    }
  });
  return result
}

let id = -1
let edgeId = -1
const getNewId = () => {
  id += 1
  return id.toString()
}

const registeredConnections = new Set()
const isDuplicateEdge = (sourceId: string, targetId: string) => {
  if(registeredConnections.has(sourceId+'->'+targetId)) return true
  registeredConnections.add(sourceId+'->'+targetId)
  return false
} 
const getEdgeNewId = () => {
  edgeId += 1
  return edgeId.toString()
}

let scopeUID = 0
const getScopeUID = () => {
  scopeUID += 1
  return scopeUID
}

let eventGraphUID = 0
const getEventGraphUID = () => {
  eventGraphUID += 1
  return eventGraphUID
}

const generateEventId = (event: EventType) => {
  // if(event.type === 'scope_change_reference' && !event.to_scope_obj.path.isArrowFunctionExpression()){
  //   if(event.to_file && event.to_scope && Number.isInteger(event.context.paramPosition)){
  //     return 'scope_change_reference-->file-->' + event.to_file 
  //     + '-->scope-->' + event.to_scope 
  //     + '-->param_position-->'+event.context.paramPosition?.toString() 
  //     + '-->variables-->' + event.context.addToNextTrackFromMemberExpressionArray
  //   }
  if(event.type === 'scope_change_reference'){
    if(event.to_file && event.to_scope && Number.isInteger(event.context.paramPosition)){
      return 'scopeUID-->' + event.to_scope_obj.uid.toString() 
      + '-->param_position-->'+event.context.paramPosition?.toString() 
      + '-->variables-->' + event.context.addToNextTrackFromMemberExpressionArray
    }
  } else if (event.type === 'in_scope_reference'){
    if(event.to_file && event.to_scope){
      return 'in_scope_reference-->file-->' + event.to_file 
      + '-->scope-->' + event.to_scope 
      + '-->to_var-->' + event.to_var
      + '-->variables-->' + event.context.currentTrackFromMemberExpressionArray
    }
  }
}
const eventNodes: {[key: string]: GraphEventNode} = {}
const visitedNodes = new Set()
const visitedForFragment = new Set()

const processFragmentStringValue = (contentSet: Set<string>, name: string, fragmentType?: string) => {
  const contentObj = turnArrayIntoObject(Array.from(contentSet).map(memberExpression => memberExpression.includes('...') ? [memberExpression] : memberExpression.split('.')))
  const fragmentContent: string = JSON.stringify({...contentObj}, null, 2) || "";
  const formatedFragmentContent = fragmentContent.substring(1, fragmentContent.length - 1);
  return `fragment ${name} on ${fragmentType || 'fragmentType'} {${formatedFragmentContent}}`
    .replace(/: {}/g, "")
    .replace(/,/g, "")
    .replace(/"/g, "")
    .replace(/: {/g, " {");
}

const processFragmentStringValue2 = (contentObj: {[key: string]: any}, name: string, fragmentType?: string) => {
  const fragmentContent: string = JSON.stringify({...contentObj}, null, 2) || "";
  const formatedFragmentContent = fragmentContent.substring(1, fragmentContent.length - 1);
  return `fragment ${name} on ${fragmentType || 'fragmentType'} {${formatedFragmentContent}}`
    .replace(/: {}/g, "")
    .replace(/,/g, "")
    .replace(/"/g, "")
    .replace(/: {/g, " {");
}

class GenericGraphNode{
  name: string;
  type: "expression_reference" | "scope_change_reference" | "scope_change_rename" | "in_scope_reference" | "declaration";
  inputs: GenericGraphNode[];
  outputs:  GenericGraphNode[]
  event?: EventType;
  id: string
  memberExpressions: string[][]
  graphEventNode: GraphEventNode

  constructor(name: string, type: GenericGraphNode['type'], graphEventNode: GraphEventNode, event?: EventType){
    this.name = name
    this.inputs = []
    this.outputs = []
    this.type = type
    this.event = event && { ...event, loadNextEvents: null}
    this.memberExpressions = []
    this.id = getNewId()
    this.visited = false
    this.graphEventNode = graphEventNode
  
  }
  addOutputsFromArrayOfNames(names: string[], event?: EventType){
    let currentNode: GenericGraphNode = this
    while(names.length > 0){
      const newNodeName = names.pop() as string
      let newNode = currentNode.outputs.find(output => output.name === newNodeName)
      if(!newNode){
        newNode = currentNode.addOutputsAndInput(
          newNodeName, 
          "expression_reference",
          event
        )
      }
      currentNode = newNode
    } 
    return currentNode  
  }
  
  addOutputsAndInput(name: string, type: typeof this.type, event?: EventType){
    const newNode = new GenericGraphNode(name, type, this.graphEventNode, event)
    this.outputs.push(newNode)
    newNode.inputs.push(this)
    return newNode
  }
  addNodeToOutput(node: GenericGraphNode){
    this.outputs.push(node)
    node.inputs.push(this)
  }
  
  traverse(onNodeEnter: (node: GenericGraphNode)=>void){
    if(!this.visited){
      Object.values(this.outputs).forEach(output => {
        onNodeEnter(output)
        output.traverse(onNodeEnter)
      })
      this.visited = true
    }
    
  }
  get reactFlowNode(){
    const spreads: {[key: string]: string} = {}
    this.graphEventNode && Object.keys(this.graphEventNode.fragment.spreads).forEach(key => spreads[key] = processFragmentStringValue2(this.graphEventNode.fragment.spreads[key], key.replace('...', '')))
    return ({
      id: this.id, 
      type: "CustomNode", 
      position: {x: 0, y: 0}, 
      data: {
        name: this.name, 
        type: this.type,
        inputs: [''],
        outputs: [''],
        fragment: this.graphEventNode ? processFragmentStringValue2(this.graphEventNode.fragment.contentObj, this.name) : '',
        spreads: this.graphEventNode ? this.graphEventNode.fragment.spreads : {},
        contentObj: this.graphEventNode ? this.graphEventNode.fragment.contentObj : {}
        //contentSet: this.graphEventNode ? this.graphEventNode.fragment.contentSet : {}
        //event: this.event
      }
    })
  }
  get reactFlowEdges(){
    const edges: Edge[] = []
    Object.values(this.outputs).forEach(output => {
      if(!isDuplicateEdge(this.id, output.id)){
        edges.push({ 
          id: getEdgeNewId(), 
          //type: 'smoothstep',
          //style: output.event?.to_file !== output.event?.from_file ? {stroke: 'red', strokeWidth: 2} : {},
          source: this.id, 
          target: output.id, 
          sourceHandle: `in-0`,
          targetHandle: `out-0`,
        })
      }
    })
    
    return edges
  }
  getTraversedOutputsReactFlow(){
    const nodes = [this.reactFlowNode]
    const edges = [...this.reactFlowEdges]
    visitedNodes.add(this.id)
    this.traverse(
      (node: GenericGraphNode) => {        
        if(!(node.type === 'reassignment_reference' && node.outputs.length === 0)){
          nodes.push(node.reactFlowNode)
          edges.push(...node.reactFlowEdges)
        }
      }
    )
    return {nodes, edges}
  }
}

type ContentObject = {
  in_scope_references: {[key: string]: ContentObject}, 
  scope_change_references: {[key: string]: ContentObject}, 
  expression_references: Set<string>,
  paths_to_this_node: Set<string> 
}

class GraphEventNode {
  event: EventType;
  contentObj: {[key: string]: Set<string>};
  contentSet: Set<string>;
  contentObjTest: ContentObject
  fragment: ASTScope['fragment'];
  scopedGraph: any;
  nextEventsNodes: GraphEventNode[]
  id: string;  
  UID: number;
  traversed: boolean
  memberExpressionsForThisEvent: string[][]
  graphNodeInputs:  GenericGraphNode[]
  graphNodeOutputs: GenericGraphNode[]
  newGraphNode: GenericGraphNode
  ancestry: Set<number>

  constructor(event: EventType, ancestry: Set<number>){
    this.traversed = false
    this.id = generateEventId(event)
    this.UID = getEventGraphUID()
    this.ancestry = new Set(ancestry)
    this.ancestry.add(this.UID)
    if(this.id) eventNodes[this.id] = this
    this.event = event
    this.contentObj = {}
    this.contentSet = new Set()
    this.event.memberExpressionAsArray.length > 0 && this.contentSet.add(this.event.memberExpressionAsArray.join('.'))
    this.nextEventsNodes = []
    this.fragment = {
      name: event.from_scope_obj.fragment.name,
      spreads: {},
      contentObj: {},
      contentSet: new Set(),
      mergedContentObj: {},
      fragmentString: '',
      mergedFragmentString: '',
    }
    this.contentObjTest = {
      'in_scope_references': {}, 
      'scope_change_references': {}, 
      'expression_references': new Set(), 
      'paths_to_this_node': new Set()
    } as ContentObject
    this.graphNodeInputs = []
    this.graphNodeOutputs = []
    this.memberExpressionsForThisEvent = [this.event.memberExpressionAsArray]

    this.scopedGraph = {contentArray: []}
    this.composeGraph()
    
    // this.contentObj = turnArrayIntoObject(this.contentArray)
  }
  mutateEventToMatchNewReferencePathArray(event: EventType){
    event.memberExpressionAsArray.shift()
    while(event.context?.currentTrackFromMemberExpressionArray.length > 0 && event.memberExpressionAsArray.length > 0){
      if(event.context?.currentTrackFromMemberExpressionArray.shift() !== event.memberExpressionAsArray.shift()){
        return null
      }
    }
    return event
  }
  composeGraph(){
    this.nextEventsNodes = this.event.loadNextEvents().flatMap(e => {
      const _newEvent = {
        ...e,
        memberExpressionAsArray: [...e.memberExpressionAsArray],
        context: {
          ...e.context, 
          currentTrackFromMemberExpressionArray: [
            ...this.event.context.currentTrackFromMemberExpressionArray,
            ...this.event.context.addToNextTrackFromMemberExpressionArray,
          ]
        }
      }
      const newEvent = this.mutateEventToMatchNewReferencePathArray(_newEvent)
      if(newEvent){
        const newId = generateEventId(newEvent)
        if(newId && !!eventNodes[newId]){
          newEvent.memberExpressionAsArray.length > 0 && eventNodes[newId].memberExpressionsForThisEvent.push(newEvent.memberExpressionAsArray)
          if(!this.ancestry.has(eventNodes[newId].UID)){
            return [eventNodes[newId]]
          }
          return []
        }
        return [new GraphEventNode(newEvent, this.ancestry)]
      }
      return []
    }) 
  }
  createContentSetInTraverse(eventNode: GraphEventNode){
    //eventNode.contentArray.forEach(arr => this.contentArray.push([...(this.event.memberExpressionAsArray || []), ...arr]))
    eventNode.contentSet.forEach(set => {
      this.memberExpressionsForThisEvent.forEach(memberExpression => {
        this.contentSet.add(`${memberExpression.length > 0 ? memberExpression.join('.') : ''}${memberExpression.length > 0 && set !== '' ? '.' : ''}${set}`)
      })
    })
  }
  createContentObjInTraverse(eventNode: GraphEventNode){
    if(eventNode.event.type === 'scope_change_reference'){
      if(this.contentObj[eventNode.event.to_scope]){
        eventNode.contentSet.forEach(set => this.contentObj[eventNode.event.to_scope].add(set))
      } else {
        this.contentObj[eventNode.event.to_scope] = new Set(eventNode.contentSet);
      }
    }
    // eventNode.contentSet.forEach(set => this.contentObj.add(`${this.event.memberExpressionAsArray.length > 0 ? this.event.memberExpressionAsArray.join('.') : ''}${this.event.memberExpressionAsArray.length > 0 && set !== '' ? '.' : ''}${set}`))
  }
  createFragmentInTraverse(){
    this.memberExpressionsForThisEvent.forEach(memberExpression => memberExpression.length > 0 && this.fragment.contentSet.add(memberExpression.join('.')))    
  }
  separateContentArrayIntoScopes(eventNode: GraphEventNode){
    if(eventNode.event?.type === 'scope_change_reference'){
      if(this.scopedGraph[eventNode.event.to_scope]){
        this.scopedGraph[eventNode.event.to_scope] = {
          ...this.scopedGraph[eventNode.event.to_scope],
          ...eventNode.scopedGraph,
          contentArray: [
            ...this.scopedGraph[eventNode.event.to_scope].contentArray,
            ...eventNode.scopedGraph.contentArray,
            eventNode.event.memberExpressionAsArray
          ]
        }
      } else {
        this.scopedGraph[eventNode.event.to_scope] = {
          ...eventNode.scopedGraph,
          contentArray: [
            ...eventNode.scopedGraph.contentArray,
            eventNode.event.memberExpressionAsArray
          ]
        }
      }
    } else if(eventNode.event?.type === 'in_scope_reference'){
      this.scopedGraph = {
        ...this.scopedGraph,
        ...eventNode.scopedGraph,
        contentArray: [
          ...this.scopedGraph.contentArray,
          ...eventNode.scopedGraph.contentArray,
          eventNode.event.memberExpressionAsArray
        ]
      }
    } else if(eventNode.event?.type === 'expression_reference'){
      this.scopedGraph.contentArray.push(eventNode.event.memberExpressionAsArray)
    }
  }
  traverse(){
    if(!this.traversed){
      this.traversed = true
      this.registerEvent(this.event)
      //this.createFragmentInTraverse()
      
      this.memberExpressionsForThisEvent.forEach(memberExpression => {
        this.contentSet.add(memberExpression.join('.'))
        memberExpression.length > 0 && this.contentObjTest['paths_to_this_node'].add(memberExpression.join('.'))
      })
      this.nextEventsNodes.forEach(eventNode => {
        eventNode.traverse()

        if (eventNode.event.type === 'scope_change_reference'){
          this.contentObjTest['scope_change_references'][eventNode.event.to_scope] = eventNode.contentObjTest
          //this.fragment.spreads[eventNode.event.to_scope] = eventNode.event.to_scope_obj.fragment
        } else if (eventNode.event.type === 'in_scope_reference' && eventNode.event.to_var){
          this.contentObjTest['in_scope_references'][eventNode.event.to_var] = eventNode.contentObjTest
        } else if (eventNode.event.type === 'expression_reference'){
          this.contentObjTest['expression_references'].add(...eventNode.contentObjTest['paths_to_this_node'])
        }

        this.createContentSetInTraverse(eventNode)

        eventNode.graphNodeInputs.forEach(node => {
          this.graphNodeOutputs.forEach(output => {
            output.addNodeToOutput(node)
          })
        })
      })
      
    }
  }
  getFragment(){
    const spreads: {[key: string]: any} = {}
    const traverse = (eventNode: GraphEventNode, mutatableObj: {[key: string]: any}) => {
      if(!visitedForFragment.has(eventNode.UID)){
        visitedForFragment.add(eventNode.UID)
        eventNode.nextEventsNodes.forEach(node => {
          let currentObj = mutatableObj
          node.memberExpressionsForThisEvent.forEach(memberExpression => {
            currentObj = mutatableObj
            memberExpression.forEach(name => {
              currentObj[name] = currentObj[name] || {}
              currentObj = currentObj[name]
            })
            if(node.event.type === 'scope_change_reference'){
              const nextNodeSpread = node.getFragment()
              if(Object.keys(nextNodeSpread).length > 0){
                spreads[`...${node.event.to_scope}`] = spreads[`...${node.event.to_scope}`] ? {...spreads[`...${node.event.to_scope}`], ...nextNodeSpread} : nextNodeSpread
                Object.keys(node.fragment.spreads).forEach(spread => {
                  spreads[spread] = spreads[spread] ? {...spreads[spread], ...node.fragment.spreads[spread]} : node.fragment.spreads[spread]
                })
                currentObj[`...${node.event.to_scope}`] = {}
              }
            } else {
              traverse(node, currentObj)
            }
          })
        })
      }
      
    }
    const mutatableObj = {}
    
    traverse(this, mutatableObj)
    this.fragment.contentObj = mutatableObj
    this.fragment.fragmentString = processFragmentStringValue2(mutatableObj, this.fragment.name)
    this.fragment.spreads = spreads
    return mutatableObj
  }
  registerEvent(event: EventType){
    if (event.type === "scope_change_reference") {
      return this.registerScopeChangeEvent(event)
    } else if (event.type === "in_scope_reference") {
      return this.registerAssignmentReferenceEvent(event)
    } else if (event.type === "declaration") {
      return this.registerDeclarationEvent(event)
    }
    return this.registerExpressionReferenceEvent(event)
  }
  registerDeclarationEvent(event: EventType){
    const firstNode = new GenericGraphNode(event.from_var, 'declaration', this, event) 
    this.graphNodeOutputs.push(firstNode)
    this.graphNodeInputs.push(firstNode)
    return firstNode
  }
  registerExpressionReferenceEvent(event: EventType){
    const mutatableCompleteFromVar = [...event.memberExpressionAsArray].reverse()
    const firstNode = new GenericGraphNode(mutatableCompleteFromVar.pop(), 'expression_reference', this, event)
    const endNode = firstNode.addOutputsFromArrayOfNames(mutatableCompleteFromVar, event)
    this.graphNodeOutputs.push(endNode)
    this.graphNodeInputs.push(firstNode)
    return firstNode
  }
  registerScopeChangeEvent(event: EventType){
    const endNode = new GenericGraphNode(event.to_scope, "scope_change", this, event)
    this.graphNodeOutputs.push(endNode)
    const firstNodes: GenericGraphNode[] = []
        this.memberExpressionsForThisEvent.forEach(memberExpression => {
      const mutatableCompleteFromVar = [...memberExpression].reverse()
      if(mutatableCompleteFromVar.length > 0) {
        const firstNode = new GenericGraphNode(mutatableCompleteFromVar.pop(), 'expression_reference', this, event)
        firstNode.addOutputsFromArrayOfNames(mutatableCompleteFromVar, event).addNodeToOutput(endNode)
        firstNodes.push(firstNode)
      }
    })
    if (firstNodes.length > 0) this.graphNodeInputs = firstNodes
    else this.graphNodeInputs.push(endNode)
    return endNode
  }
  registerAssignmentReferenceEvent(event: EventType){
    const endNode = new GenericGraphNode(`${event.to_var}${event.context.currentTrackFromMemberExpressionArray.length > 0 ? '.'+event.context.currentTrackFromMemberExpressionArray.join('.') : ''}` || 'error', "reassignment_reference", this, event)
    this.graphNodeOutputs.push(endNode)
    const firstNodes: GenericGraphNode[] = []
    this.memberExpressionsForThisEvent.forEach(memberExpression => {
      const mutatableCompleteFromVar = [...memberExpression].reverse()
      if(mutatableCompleteFromVar.length > 0) {
        const firstNode = new GenericGraphNode(mutatableCompleteFromVar.pop(), 'expression_reference', this, event)
        firstNode.addOutputsFromArrayOfNames(mutatableCompleteFromVar, event).addNodeToOutput(endNode)
        firstNodes.push(firstNode)
      }
    })
    if (firstNodes.length > 0) this.graphNodeInputs = firstNodes
    else this.graphNodeInputs.push(endNode)
    return endNode
  }
  traverseContentObjAndCreateReactFlowGraph(){
    const traverse = (contentObj: ContentObject) =>{
      const nodes: GenericGraphNode[] = []
      const scopeChanges = Object.keys(contentObj['scope_change_references'])
      const variableNameChanges = Object.keys(contentObj['in_scope_references'])
      const expressions = Array.from(contentObj['expression_references'])
      nodes.push(...expressions.map(expression => {
        const mutatableExpression = expression.split('.').reverse()
        const newNode = new GenericGraphNode(mutatableExpression.pop(), 'expression_reference', this)
        newNode.addOutputsFromArrayOfNames(mutatableExpression)
        return newNode
      }))
      scopeChanges.forEach(scope => {
        const newScopeNode = new GenericGraphNode(scope, "scope_change", this)
        const newNodes = Array.from(contentObj['scope_change_references'][scope]['paths_to_this_node']).map(expression => {
          const mutatableExpression = expression.split('.').reverse()
          const newNode = new GenericGraphNode(mutatableExpression.pop(), 'expression_reference', this)
          newNode.addOutputsFromArrayOfNames(mutatableExpression).addNodeToOutput(newScopeNode)
          return newNode
        })
        traverse(contentObj['scope_change_references'][scope]).forEach(node => {
          newScopeNode.addNodeToOutput(node)
        })
        if (newNodes.length === 0) newNodes.push(newScopeNode)
        nodes.push(...newNodes)
      })
      variableNameChanges.forEach(variable => {
        const newVariableNodeNode = new GenericGraphNode(`${variable}`, "reassignment_reference", this)
        const newNodes = Array.from(contentObj['in_scope_references'][variable]['paths_to_this_node']).map(expression => {
          const mutatableExpression = expression.split('.').reverse()
          const newNode = new GenericGraphNode(mutatableExpression.pop(), 'expression_reference', this)
          newNode.addOutputsFromArrayOfNames(mutatableExpression).addNodeToOutput(newVariableNodeNode)
          return newNode
        })
        traverse(contentObj['in_scope_references'][variable]).forEach(node => {
          newVariableNodeNode.addNodeToOutput(node)
        })
        if (newNodes.length === 0) newNodes.push(newVariableNodeNode)
        nodes.push(...newNodes)
      })
      return nodes
    }
    this.newGraphNode = new GenericGraphNode(this.event.from_var, 'declaration', this, this.event)
    traverse(this.contentObjTest).forEach(node => {
      this.newGraphNode.addNodeToOutput(node)
    })
    return this.newGraphNode
  }
}


class ASTScope {
  scope: Scope;
  path: NodePath;
  uid: number;
  name: string;
  aliasName: string;
  type: string;
  file: string;
  parent: ASTScope | null;
  ScopeReferencesAndAssignments: {
    references: { [key: string]: NodePath[] };
    assignments: { [key: string]: NodePath };
  };
  scopeAfterProgram: ASTScope | null | undefined; // this variable hold a reference to the scope at the most top level, only bellow the program itself (useful to locate component scope)
  childScopes: ASTScope[];
  trackedVars: string[];
  imports: {[name: string]: {realName: string, localName: string, ASTScope: ASTScope | null, codeImportedSuccess: boolean, code: string | null, getASTScopeFromCodeFn: ()=>ASTNode | null}}
  fragment: {
    name: string,
    spreads: {[name: string]: any},
    contentObj: any,
    contentSet: Set<string>
    mergedContentObj: any,
    fragmentString: string,
    mergedFragmentString: string,
  }
  exported: boolean;
  defaultExported: boolean;
  events: {[key: string]: EventType[]}
  graphs: {[key: string]: GraphEventNode}

  constructor(scope: Scope, uid: number, parent: ASTScope | null = null) {
    this.scope = scope;
    this.path = scope.path;
    this.exported = this.path.parentPath?.isExportNamedDeclaration() || false
    this.defaultExported = this.path.parentPath?.isExportDefaultDeclaration() || false
    this.file = this.path.node.loc?.filename || ''
    if (this.path.isClassMethod()) {
      this.name = this.path.node.key?.name;
    } else if (
      this.path.isArrowFunctionExpression() &&
      this.path.parentPath.isVariableDeclarator()
    ) {
      this.name = this.path.parent.id?.name;
    } else if( 
      this.path.isArrowFunctionExpression()
    ) {
      this.name = 'ArrowFunction';
    }else {
      this.name = this.path.node?.id?.name;
    }
    this.name = this.name || "Program";
    this.aliasName = this.name
    this.type = this.path.type;
    this.imports = {}
    this.trackedVars = [];
    this.uid = uid;
    this.parent = parent;
    this.childScopes = [];

    this.scope.setData("ASTScope", this);
    this.scope.setData("name", this.name);

    if (this.parent) this.parent.childScopes.push(this);

    this.events = {}
    this.graphs = {}
    this.ScopeReferencesAndAssignments = {
      references: {},
      assignments: {},
    };
    if (this.path.isClassDeclaration()) {
      const classDeclarations = this.path.get("body").get("body") || [];
      for (const declar of classDeclarations) {
        if (declar.isClassMethod() && declar.node.key?.name)
          this.ScopeReferencesAndAssignments.assignments[declar.node.key.name] = declar;
      }
    }

    const fragmentType = 'fragmentType'
    this.fragment = {
      name: `${this.name}_${fragmentType}`,
      spreads: {},
      contentObj: {},
      contentSet: new Set(),
      mergedContentObj: {},
      fragmentString: '',
      mergedFragmentString: '',
    }
  }
  registerThisReference(ref: NodePath<ThisExpression>) {
    const parentExpression = ref.findParent(
      (path) => !path.isMemberExpression() && !path.isOptionalMemberExpression(),
    );
    if(parentExpression){
      if(!this.ScopeReferencesAndAssignments.assignments['this']) this.ScopeReferencesAndAssignments.assignments['this'] = ref;
      this.ScopeReferencesAndAssignments.references['this'] = this
        .ScopeReferencesAndAssignments.references['this']
        ? [
            ...this.ScopeReferencesAndAssignments.references['this'],
            ref,
          ]
        : [ref];
    }
    
  }
  getASTScope(scopeName: string) {
    let astScope: ASTScope | null | undefined = null;
    let currentScope: ASTScope | null = this;
    while (currentScope !== null && astScope === null) {
      currentScope && currentScope.childScopes.find(scope => scope.name === scopeName)
        ? (astScope = currentScope.childScopes.find(scope => scope.name === scopeName))
        : (currentScope = currentScope?.parent || null);
      if (astScope === null && currentScope){
        Object.values(currentScope.imports).forEach(imported => {
          if(imported.localName === scopeName){
            astScope = imported.getASTScopeFromCodeFn() || null
          }
        })
      }
    }
    return astScope;
  }
  processReferences() {
    Object.entries(this.scope.bindings).forEach(([name, bind]) => {
      this.ScopeReferencesAndAssignments.assignments[name] = bind.path;
      this.ScopeReferencesAndAssignments.references[name] = this.ScopeReferencesAndAssignments
        .references[name]
        ? [...this.ScopeReferencesAndAssignments.references[name], ...bind.referencePaths]
        : bind.referencePaths;
    });
  }
  getRootOfMemberExpression(node: NodePath) {
    return node.parentPath && (node.parentPath.isMemberExpression() || node.isOptionalMemberExpression())
      ? node.findParent(
          (node) =>
            !node.parentPath?.isMemberExpression() &&
            !node.parentPath?.isOptionalMemberExpression(),
        )
      : node;
  }
  getMemberExpressionAsArray(node: NodePath): string[] {
    const names: string[] = [];
    let keepAddingNames = true
    if (node.parentPath?.isMemberExpression() || node.parentPath?.isOptionalMemberExpression()) {
      const rootNode = node.findParent(
        (node) =>
          !node.parentPath?.isMemberExpression() &&
          !node?.parentPath?.isOptionalMemberExpression(),
      );
      rootNode &&
        rootNode.traverse({
          enter(path) {
            if(keepAddingNames){
              if(path.isIdentifier()) {
                if(!RESERVED_MEMBER_EXPRESSIONS.has(path.node.name) && !(path.parentPath.isMemberExpression() && path.parentPath.node.computed)) names.push(path.node.name)
                else keepAddingNames = false
              } else if (path.isStringLiteral()) { 
                if(!RESERVED_MEMBER_EXPRESSIONS.has(path.node.value)) names.push(path.node.value)
                else keepAddingNames = false
              } else if (path.isThisExpression()) {
                names.push('this')
              }
            }
          },
        });
    } else {
      'name' in node.node && typeof node.node.name === 'string' && names.push(node.node.name);
    }
    return names;
  }
  processEventsOfBinding(bindingName: string){
    return this.ScopeReferencesAndAssignments.references[bindingName].flatMap(ref => {
      if(ref.isIdentifier() || ref.isThisExpression()) return this.processReferenceIntoEvents(ref)
      else return []
    })
  }
  processReferenceIntoEvents(ref: NodePath<Identifier | ThisExpression>) {
    const originName = ref.isIdentifier() ? ref.node.name : 'this'
    const memberExpressionStringArray = this.getMemberExpressionAsArray(ref);

    const events: EventType[] = []

    // go back to check what type of node made this reference
    const rootMemberExpression = this.getRootOfMemberExpression(ref);
    const declarator = rootMemberExpression?.parentPath;
    if (!declarator || !rootMemberExpression) return events;

    let registeredEvent = false
    const currentTrackFromMemberExpressionArray: string[] = []

    const subFieldCallExpresison = rootMemberExpression.key === 'callee' ? memberExpressionStringArray.pop() : null
    //if(RESERVED_MEMBER_EXPRESSIONS.has(memberExpressionStringArray[memberExpressionStringArray.length-1])) memberExpressionStringArray.pop()
    rootMemberExpression.find((path) => {
      if(path.key === 'body') return true
      if(path.parentPath?.isLogicalExpression()){
        if(path.parentPath.node.operator === '&&' && path.key === 'left'){
          return true
        }
      }
      if(path.isObjectProperty()) {
        path.node.key && 'name' in path.node.key && currentTrackFromMemberExpressionArray.push(path.node.key.name)
      }
      if (path.parentPath?.isVariableDeclarator()) {
        /* If its declaring a variable, it means that its creating a new variable in memory 
        to store a subfield of the tracked variable. In this case, store an InScopeChange event 
        i.e: const z = tracked_variable.x.y , in case its an destructing (ObjectPattern) store it
        along its declaration name i.e: const { y } = tracked_variable.x */
        events.push(...this.mapInScopeChanges(memberExpressionStringArray, currentTrackFromMemberExpressionArray, path.parentPath, originName));
        registeredEvent = true
        return true;
      } else if ((path.parentPath?.isCallExpression() && path.key !== 'callee') || (path.parentPath?.isJSXExpressionContainer() && path.parentPath?.parentPath.isJSXAttribute())) {
        const scopeChangeEvent = this.mapScopeChanges(memberExpressionStringArray, currentTrackFromMemberExpressionArray, path, originName)
        scopeChangeEvent && events.push(scopeChangeEvent)
        registeredEvent = true
        return true;
      } else if (path.parentPath?.isCallExpression() && path.key === 'callee' && subFieldCallExpresison && RESERVED_ARRAY_FUNCTIONS.has(subFieldCallExpresison)){
        const arrayMapScopeChangeEvent = this.mapArrayLoopScopeChangeEvent(memberExpressionStringArray, currentTrackFromMemberExpressionArray, path, originName)
        arrayMapScopeChangeEvent && events.push(arrayMapScopeChangeEvent)
        registeredEvent = true
        return true
      }
      return false;
    });
    /* if there was not an assigment neither a unpacking, just acknowledge it and add it bus
    i.e const returnMock = tracked.trackNum.MadeUpVariable + 1, because of the +1, it wont detect
    the variableDeclarator, and I guess it should not detect it. */
    if(!registeredEvent && memberExpressionStringArray.length > 1) events.push(this.mapRawReferences(memberExpressionStringArray, originName))
    return events
  }
  mapArrayLoopScopeChangeEvent(
    memberExpressionStringArray: string[], 
    objectExpressionUntilReference: string[], 
    rootNode: NodePath<Node>, 
    originName: string
  ){
    const expression = rootNode.parentPath;
    if (!expression) return;
    if (expression.isCallExpression()) {
      const args = expression.get("arguments");
      const toFunction = args.length > 0 && (args[0].isArrowFunctionExpression() || args[0].isFunctionExpression()) ? args[0] : null
      const params = toFunction && toFunction.get("params") && toFunction.get("params") ? toFunction.get("params") : null
      if (toFunction && params && Array.isArray(params) && params.length > 0) {
        const toASTScope: ASTScope = toFunction.scope.getData("ASTScope")
        const target = params[0]
        const event: EventType = {
          type: "scope_change_reference",
          from_var: originName,
          to_var: target.node.name,
          memberExpressionAsArray: memberExpressionStringArray,
          from_scope: this.name,
          to_scope: toASTScope.name,
          from_file: this.file,
          to_file: toASTScope.file,
          from_scope_obj: this,
          to_scope_obj: toASTScope,
          context: {
            addToNextTrackFromMemberExpressionArray: objectExpressionUntilReference,
            currentTrackFromMemberExpressionArray: [],
            targetType: "function",
            paramPosition: 0
          },
          loadNextEvents: () => { 
            if(target.isObjectPattern()){
              const membersExpressions: string[][] = [];
              const declarations: NodePath<Identifier | ObjectProperty>[] = [];

              // objectPattern in case we find something like ===> const {var, otherVar} = data
              const [unwrapedNames, objectProperties] = this.getObjectPatternAsArray(target);
              declarations.push(...objectProperties);
              membersExpressions.push(...unwrapedNames.map(n => [ memberExpressionStringArray[memberExpressionStringArray.length-1], ...n ]))
            
              const events: EventType[] = []
              declarations.forEach((decl, i) => {
                const to_var = decl.isIdentifier() ? decl.node?.name : decl.get("value")?.node?.name;
                if(to_var && typeof to_var === 'string'){
                  const event: EventType = {
                    type: "in_scope_reference",
                    from_var: originName,
                    to_var: to_var,
                    memberExpressionAsArray: membersExpressions[i],
                    from_scope: this.name,
                    to_scope: toASTScope.name,
                    from_file: this.file,
                    to_file: toASTScope.file,
                    from_scope_obj: this,
                    to_scope_obj: toASTScope,
                    context: {
                      addToNextTrackFromMemberExpressionArray: objectExpressionUntilReference,
                      currentTrackFromMemberExpressionArray: [],
                      targetType: 'ObjectPatternParam',
                    },
                    loadNextEvents: () => toASTScope.getEventsFromBinding(to_var)
                  }
                  events.push(event)
                };
              });
              return events
            } else if(target.isIdentifier()){
              return toASTScope.getEventsFromBinding(target.node.name)
            }
            return []
          }
        }
      
        return event
      }
    }
  }
  mapInScopeChanges(
    memberExpressionStringArray: string[],  // this is the member expression used in the referece => const newVar = var.child.grandChild ===> memberExpressionStringArray = [var, child, grandChild]
    objectExpressionUntilReference: string[], // in case of var wrapping => const newVar = {field: {subField: var.child.grandChild}} ===>  objectExpressionUntilReference = [field, subfield]
    variableDeclaratorNode: NodePath<VariableDeclarator>, 
    referencedVariableName: string,
    //after changing reference, the true path to track would be objectExpressionUntilReference + memberExpressionStringArray => newVar + [field, subfield] = [var, child, grandChild]
    // so, on each event in newVar, we will only track it if the memberExpressionStringArray = [field, subfield], we dont care about the other events
  ){
    const membersExpressions: string[][] = [];
    const declarations: NodePath<Identifier | ObjectProperty>[] = [];
 
    const variableDeclaratorNodeId = variableDeclaratorNode.get("id");
    // objectPattern in case we find something like ===> const {var, otherVar} = data
    if (variableDeclaratorNodeId.isObjectPattern()) {
      const [unwrapedNames, objectProperties] = this.getObjectPatternAsArray(variableDeclaratorNodeId);
      declarations.push(...objectProperties);
      membersExpressions.push(...unwrapedNames.map((n) => memberExpressionStringArray.concat(n)));
    } else if (variableDeclaratorNodeId.isIdentifier()) {
      membersExpressions.push(memberExpressionStringArray);
      declarations.push(variableDeclaratorNodeId);
    }
    const events: EventType[] = []
    declarations.forEach((decl, i) => {
      const to_var = decl.isIdentifier() ? decl.node?.name : decl.get("value")?.node?.name;
      if(to_var && typeof to_var === 'string'){
        const event: EventType = {
          type: "in_scope_reference",
          from_var: referencedVariableName,
          to_var: to_var,
          memberExpressionAsArray: membersExpressions[i],
          from_scope: this.name,
          to_scope: decl.scope.getData("ASTScope").name,
          from_file: this.file,
          to_file: decl.scope.getData("ASTScope").file,
          from_scope_obj: this,
          to_scope_obj: decl.scope.getData("ASTScope"),
          context: {
            addToNextTrackFromMemberExpressionArray: objectExpressionUntilReference,
            currentTrackFromMemberExpressionArray: [],
            targetType: variableDeclaratorNode.parentPath.isVariableDeclaration() ? variableDeclaratorNode.parentPath.node.kind : null,
          },
          loadNextEvents: () => decl.scope.getData("ASTScope").getEventsFromBinding(to_var)
        }
        events.push(event)
      };
    });
    return events
  }
  mapRawReferences(memberExpressionStringArray: string[], originName: string) {
    const event: EventType = {
      type: "expression_reference",
      from_var: originName,
      to_var: null,
      memberExpressionAsArray: memberExpressionStringArray,
      from_scope: this.name,
      to_scope: this.name,
      from_file: this.file,
      to_file: this.file,
      from_scope_obj: this,
      to_scope_obj: this,
      context: {
        addToNextTrackFromMemberExpressionArray: [],
        currentTrackFromMemberExpressionArray: [],
        targetType: null,
        errorMessages: []
      },
      loadNextEvents: () => []
    };
    return event
  }
  mapScopeChanges(memberExpressionStringArray: string[], objectExpressionUntilReference: string[], rootNode: NodePath<Node>, originName: string) {
    const expression = rootNode.parentPath;
    if (!expression) return;
    if (expression.isCallExpression()) {
      const rootKey = rootNode.key;
      let toScope: NodePath = expression.get("callee");
      if (
        (toScope.isMemberExpression() || toScope.isOptionalMemberExpression()) &&
        toScope.get("property").isIdentifier()
      ) {
        toScope = toScope.get("property");
      }
      if (toScope.isIdentifier()) {
        const toASTScope = this.getASTScope(toScope.node.name); // rootNode.scope.getBinding(callee.node.name) || {
        if (toASTScope && typeof rootKey === "number") {
          const params = toASTScope.path.get("params");
          const target = Array.isArray(params) ? params[rootKey] : params;
          const event: EventType = {
            type: "scope_change_reference",
            from_var: originName,
            to_var: target.node.name,
            memberExpressionAsArray: memberExpressionStringArray,
            from_scope: this.name,
            to_scope: toASTScope.name,
            from_file: this.file,
            to_file: toASTScope.file,
            from_scope_obj: this,
            to_scope_obj: toASTScope,
            context: {
              addToNextTrackFromMemberExpressionArray: objectExpressionUntilReference,
              currentTrackFromMemberExpressionArray: [],
              targetType: "function",
              paramPosition: rootKey
            },
            loadNextEvents: () => { 
              if(target.isObjectPattern()){
                const membersExpressions: string[][] = [];
                const declarations: NodePath<Identifier | ObjectProperty>[] = [];
  
                // objectPattern in case we find something like ===> const {var, otherVar} = data
                const [unwrapedNames, objectProperties] = this.getObjectPatternAsArray(target);
                declarations.push(...objectProperties);
                membersExpressions.push(...unwrapedNames.map(n => [ memberExpressionStringArray[memberExpressionStringArray.length-1], ...n ]))
              
                const events: EventType[] = []
                declarations.forEach((decl, i) => {
                  const to_var = decl.isIdentifier() ? decl.node?.name : decl.get("value")?.node?.name;
                  if(to_var && typeof to_var === 'string'){
                    const event: EventType = {
                      type: "in_scope_reference",
                      from_var: originName,
                      to_var: to_var,
                      memberExpressionAsArray: membersExpressions[i],
                      from_scope: this.name,
                      to_scope: toASTScope.name,
                      from_file: this.file,
                      to_file: toASTScope.file,
                      from_scope_obj: this,
                      to_scope_obj: toASTScope,
                      context: {
                        addToNextTrackFromMemberExpressionArray: objectExpressionUntilReference,
                        currentTrackFromMemberExpressionArray: [],
                        targetType: 'ObjectPatternParam',
                      },
                      loadNextEvents: () => toASTScope.getEventsFromBinding(to_var)
                    }
                    events.push(event)
                  };
                });
                return events
              } else if(target.isIdentifier()){
                return toASTScope.getEventsFromBinding(target.node.name)
              }
              return []
            }
            //() => toASTScope.getEventsFromBinding(target.node.name)
          }
          return event;
          
        }
        // const event: EventType = {
        //   type: "scope_change_reference",
        //   from_var: originName,
        //   to_var: `could not find scope ${toScope.node.name}`,
        //   memberExpressionAsArray: memberExpressionStringArray,
        //   from_scope: this.name,
        //   to_scope: toScope.node.name,
        //   from_file: this.file,
        //   to_file: '',
        //   context: {
        //     addToNextTrackFromMemberExpressionArray: objectExpressionUntilReference,
        //     currentTrackFromMemberExpressionArray: [],
        //     targetType: "function",
        //     errorMessages: [`could not find scope ${toScope.node.name}`],
        //   },
        //   loadNextEvents: () => []
        // }
        // return event;
      }
    } else if (expression.isJSXExpressionContainer()) {
      const openingNode: NodePath<JSXOpeningElement> | null = rootNode.findParent((node) =>
        node.isJSXOpeningElement(),
      ) as NodePath<JSXOpeningElement>;
      const newName =
      expression.parentPath.isJSXAttribute() && expression.parentPath.get("name").node.name;

      if (openingNode && newName && typeof newName === "string") {
        const _openingName = openingNode.get("name");
        const openingName =
          !Array.isArray(_openingName) && _openingName?.isJSXIdentifier() && _openingName.node.name;
        if (openingName) {
          const toASTScope = this.getASTScope(openingName);
          if (toASTScope) {
            const to_var: string = (toASTScope.type === "ClassDeclaration" 
            ? 'this'
            : ('params' in toASTScope.path.node 
            && Array.isArray(toASTScope.path.node.params) 
            && 'name' in toASTScope.path.node.params[0]
            && typeof toASTScope.path.node.params[0].name === 'string'
            && toASTScope.path.node.params[0].name)) || ''

            const event: EventType = {
              type: "scope_change_reference",
              from_var: originName,
              to_var: newName,
              memberExpressionAsArray: memberExpressionStringArray,
              from_scope: this.name,
              to_scope: toASTScope.name,
              from_file: this.file,
              to_file: toASTScope.file,
              from_scope_obj: this,
              to_scope_obj: toASTScope,
              context: {
                addToNextTrackFromMemberExpressionArray: [
                  ...(toASTScope.type === "ClassDeclaration" ? ['props', newName] : [newName]),
                  ...objectExpressionUntilReference
                ],
                currentTrackFromMemberExpressionArray: [],
                targetType: toASTScope.type === "ClassDeclaration" ? "JSX_class" : "JSX_function",
                paramPosition: 0
              },
              loadNextEvents: () => toASTScope.getEventsFromBinding(to_var)
            }
            return event;
          }
          // const event: EventType = {
          //   type: "scope_change_reference",
          //   from_var: originName,
          //   to_var: `could not find scope ${openingName}`,
          //   memberExpressionAsArray: memberExpressionStringArray,
          //   from_scope: this.name,
          //   to_scope: openingName,
          //   from_file: this.file,
          //   to_file: '',
          //   context: {
          //     addToNextTrackFromMemberExpressionArray: objectExpressionUntilReference,
          //     currentTrackFromMemberExpressionArray: [],
          //     targetType: "function",
          //     errorMessages: [`could not find scope ${openingName}`],
          //   },
          //   loadNextEvents: () => []
          // }
          // return event;
        }
      }
    }
  }
  getObjectPatternAsArray(node: NodePath<ObjectPattern>): [string[][], NodePath<ObjectProperty>[]] {
    /// go through the object pattern and get all the leaves (ObjectProperty.get('value').isIdentifier()) and after that go back up.
    const fieldNamesArray: string[][] = [];
    const leaves: NodePath<ObjectProperty>[] = [];

    const queue: NodePath<ObjectProperty>[] = [
      ...node.get("properties").filter((n) => n.isObjectProperty()),
    ];
    while (queue.length > 0) {
      const currentNode = queue.pop();
      if (currentNode && currentNode.isObjectProperty()) {
        currentNode.get("value").isObjectPattern()
          ? queue.push(...currentNode.get("value").get("properties"))
          : leaves.push(currentNode);
      }
    }
    const returnedLeaves = [...leaves];
    while (leaves.length > 0) {
      const currentNode = leaves.shift();
      const currentNames: string[] = [currentNode.get("key").node.name];
      if (currentNode?.isObjectProperty()) {
        currentNode.findParent((path) => {
          if (!path) return false;
          if (path.parentPath?.isVariableDeclarator()) {
            return true;
          } else if (path.isObjectProperty()) {
            currentNames.push(path.get("key").node.name);
          }
          return false;
        });
        fieldNamesArray.push(currentNames.reverse());
      }
    }

    return [fieldNamesArray, returnedLeaves];
  }
  getEventsFromBinding(bindingName: string){
    if(!bindingName) return []
    if(!this.events[bindingName]) {
      this.events[bindingName] = this.processEventsOfBinding(bindingName)
    }
    return this.events[bindingName]    
  }
  getEventGraphForBinding(bindingName: string){
    if(!this.graphs[bindingName]) {
      const event: EventType = {
        type: "declaration",
        from_var: bindingName,
        to_var: bindingName,
        memberExpressionAsArray: [],
        from_scope: this.name,
        to_scope: this.name,
        from_scope_obj: this,
        to_scope_obj: this,
        context: {
          currentTrackFromMemberExpressionArray: [],
          addToNextTrackFromMemberExpressionArray: []
        },
        loadNextEvents: () => this.getEventsFromBinding(bindingName)
      }
      this.graphs[bindingName] = new GraphEventNode(event, new Set())
      this.graphs[bindingName].traverse()
    }

    return this.graphs[bindingName]
  }
  getContentSetForBinding(bindingName: string){
    const set = new Set()
    const nodes = this.getEventsFromBinding(bindingName)
    events.forEach()
  }
  processFragments(){
    function traverse(scope: ASTScope){
      scope.childScopes.forEach(childScope => {
        const {contentSet, spreads, name} = traverse(childScope)
        scope.fragment.spreads[`...${name}`] = contentSet
      })
      return {contentSet: scope.fragment.contentSet, spreads: scope.fragment.spreads, name: scope.fragment.name}
    }
    this.childScopes.forEach(childScope => { 
      const {contentSet, spreads, name} = traverse(childScope)
      this.fragment.spreads[`...${name}`] = contentSet
    })
  }
}

const processImportPath = (importPath: string, nodePath?: string) => {
  const paths = importPath.split("/")
  if (paths[0] === '.' && nodePath){
    const newPath = nodePath.split("/")
    newPath.pop()
    paths.shift()
    return [...newPath, paths].join("/")
  } else if (paths[0] === '@'){
    return importPath
  }
  return importPath
}


const readFileFromLocal = (path: string): string | null => {
  let file: string = ""
  if(existsSync(path) && lstatSync(path).isFile()){
    file = path
  } else if (globSync(path+".*")){
    file = globSync(path+".*")[0]
  }
  if(existsSync(file) && lstatSync(file).isFile()){
    const content = readFileSync(
      file,
      "utf8"
    );
    return content
  }
  
  return null
}

export default async function dataDependencyTracker(codeToParseInput?: string, filePath?: string, folderPath?: string) {
  console.log("working");
  let codeToParse: string;
  if (!codeToParseInput) {
    codeToParse = "const a = 1";
  } else {
    codeToParse = codeToParseInput;
  }

  const ast = parse(codeToParse, {
    sourceType: "module",
    sourceFilename: ((folderPath || '') + (filePath || '')) || "snippet.js",
    plugins: [
      // enable jsx and flow syntax
      "jsx",
      "typescript"
    ],
  });
  const processASTIntoScopes = (ast: Node) => {
    const scopes: ASTScope[] = [];
    const scopeQueue: ASTScope[] = [];
    const variableDeclaration: NodePath[] = [];
    const trackeds: { ASTScope: ASTScope; scope: Scope; varName: string }[] = [];
    let currentScope: ASTScope | null | undefined

    const processOnEnterPath = (path: NodePath) => {
      if (path.isScope()) {
        const newScope = new ASTScope(path.scope, getScopeUID(), scopeQueue[scopeQueue.length - 1]);
        scopes.push(newScope);
        scopeQueue.push(newScope);
        currentScope = newScope
      }
      if (path.isImportDeclaration()) {
        let importMissingScope: ASTScope['imports']['value'][] = []
        const importPath = processImportPath(((folderPath || '') + path.node.source.value), path.node.loc?.filename)
        const code = readFileFromLocal(importPath)
        if(code){
          path.node.specifiers.forEach((imported) => {
            if (currentScope && imported.type === 'ImportDefaultSpecifier'){
              currentScope.imports[imported.local.name] = {
                realName: imported.local.name,
                localName: imported.local.name, 
                ASTScope: null, 
                codeImportedSuccess: false,
                code: code,
                getASTScopeFromCodeFn: () => {
                  const ast = parse(code, {
                    sourceType: "module",
                    sourceFilename: importPath,
                    plugins: [
                      // enable jsx and flow syntax
                      "jsx",
                      "typescript",
                    ],
                  });
                  const {scopes} = processASTIntoScopes(ast) // after this function, current function will be the top level Program of the imported file
                  return scopes.find(scope => scope.defaultExported) || null
                }
              }
              importMissingScope.push(currentScope.imports[imported.local.name])
            } 
            else if (currentScope && imported.type === 'ImportSpecifier') {
              const realName = imported.imported.type === 'Identifier' 
              ? imported.imported.name 
              : imported.imported.value
              currentScope.imports[realName] = {
                realName: realName,
                localName: imported.local.name, 
                ASTScope: null,
                codeImportedSuccess: false,
                code: code,
                getASTScopeFromCodeFn: () => {
                  const ast = parse(code, {
                    sourceType: "module",
                    sourceFilename: importPath,
                    plugins: [
                      // enable jsx and flow syntax
                      "jsx",
                      "typescript",
                    ],
                  });
                  const {scopes} = processASTIntoScopes(ast) // after this function, current function will be the top level Program of the imported file
                  return scopes[0]?.getASTScope(realName) || null
                }
              }

              importMissingScope.push(currentScope.imports[imported.imported.type === 'Identifier' 
              ? imported.imported.name 
              : imported.imported.value])
            }
          })


        }
      }
      if (
        path.node.leadingComments &&
        path.node.leadingComments.length > 0 &&
        path.node.leadingComments.some((line) => line.value.includes(trackVariableCommentTag))
      ) {
        const trackedLine = path.node.leadingComments.find((line) =>
          line.value.includes(trackVariableCommentTag),
        )?.value;
        const trackedName = trackedLine?.split("=")[1];
        if (trackedName) {
          trackeds.push({ ASTScope: currentScope, scope: path.scope, varName: trackedName });
        }
      }
    
      if (path.isVariableDeclaration()) {
        variableDeclaration.push(path);
        // detect tracked variables
        if (
          path.node.leadingComments &&
          path.node.leadingComments.length > 0 &&
          path.node.leadingComments.some((line) => line.value === trackCommentTag)
        ) {
          
          path.get("declarations").forEach((decl) => {
            decl.setData("tracked", true)
            'name' in decl.node.id && trackeds.push({ ASTScope: path.scope.getData("ASTScope"), scope: path.scope, varName: decl.node.id.name });
          });
        }
      }
      if (path.isThisExpression()) {
        const classScope = path
          .findParent((parent) => parent.isClassDeclaration())
          ?.scope?.getData("ASTScope");
    
        classScope.registerThisReference(path);
      }
      if(path.isExportDefaultDeclaration()) {
        if (path.node.declaration.type === 'Identifier') {
          const scope = scopes[0].getASTScope(path.node.declaration.name)
          if(scope){
            scope.defaultExported = true
          }
        }
      }
    }

    const processOnExitPath = (path: NodePath) => {
      if (path.isScope()) {
        currentScope = scopeQueue.pop();
      }
    }
    traverse(ast, {
      enter(path) {
        processOnEnterPath(path)
      },
      exit(path) {
        processOnExitPath(path)
      },
    });
    
    scopes.forEach((scope) => {
      scope.processReferences();
    });
    trackeds.forEach(({ ASTScope, varName }) => {
      ASTScope.getEventsFromBinding(varName)
      ASTScope.getEventGraphForBinding(varName)
      
    });
    
    return {scopes, trackeds}
  }
  
  const {scopes, trackeds} = processASTIntoScopes(ast)
  
  const results = trackeds.map(({ varName, ASTScope: {events, graphs, fragment} }) => ({
    fragment: graphs[varName].getFragment(),
    graph: graphs[varName].graphNodeInputs[0]?.getTraversedOutputsReactFlow(), //{nodes:[], edges:[]}
    contentArray: graphs[varName].contentSet,
    contentObj: graphs[varName].contentObjTest,
    //newGraphNode: graphs[varName].traverseContentObjAndCreateReactFlowGraph().getTraversedOutputsReactFlow(),
    
    //node: node.getTraversedOutputsReactFlow(),
  }));
 
  return results


}