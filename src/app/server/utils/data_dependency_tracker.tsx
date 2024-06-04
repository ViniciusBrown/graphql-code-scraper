"use server"

import { parse } from "@babel/parser";
import traverse, { Node, NodePath as NodePath, Scope } from "@babel/traverse";
import {
  File,
  Identifier,
  JSXOpeningElement,
  ObjectPattern,
  ObjectProperty,
  Program,
  ThisExpression,
} from "@babel/types";
import { globSync } from 'glob'
import { readFileSync, lstatSync, existsSync } from "fs"
import { Edge } from "reactflow";

type EventType = {
  type: "expression_reference" |
  "in_scope_reference" |
  "scope_change_reference";
  from_var: string;
  to_var: null | string;
  to_obj: null | ASTNode;
  memberExpressionAsArray: string[];
  from_scope: string;
  to_scope: string;
  id?: string;
};

type FragmentType = {
  name: string;
  contentObj: { [key: string]: any };
  scopeContentObj: { [key: string]: any };
  mergedContentObj: { [key: string]: any };
  value: string;
  fragmentsReferences: string[];
  mergedValue: string;
  scopeValue: string;
};

const trackCommentTag = "track_this_variable";
const trackVariableCommentTag = "track_variable=";

const getLastObj = (objToAdd: any, nextFields: string[][]) => {
  nextFields.forEach((fields) => {
    const fieldsCopy = [...fields];
    if (fieldsCopy.length > 0) {
      const firstField = fieldsCopy.shift();
      if (firstField) {
        objToAdd[firstField] = objToAdd[firstField] ? objToAdd[firstField] : {};
        let currentField = objToAdd[firstField];
        fieldsCopy.forEach((field) => {
          currentField[field] = currentField[field] ? currentField[field] : {};
          currentField = currentField[field];
        });
      }
    }
  });
};

let id = -1
const getNewId = () => {
  id += 1
  return id
}

class SubField {
  owner: ASTNode;
  name: string;
  subfields: { [key: string]: { name: string; obj: SubField; subfields: SubField["subfields"] } };
  parentField: SubField | null;
  tracked: boolean;

  constructor(
    owner: ASTNode,
    name: string,
    parentField: SubField | null = null,
    tracked: boolean = false,
  ) {
    this.owner = owner;
    this.name = name;
    this.parentField = parentField;
    this.subfields = {};
    this.tracked = tracked;
  }
  registerFromArray(arr: string[]) {
    if (arr.length === 0) return;
    const firstElement = arr.shift() || "";
    this.subfields[firstElement] =
      firstElement && this.subfields[firstElement]
        ? this.subfields[firstElement]
        : { name: firstElement, obj: new SubField(this.owner, firstElement), subfields: {} };
    let overwritten = this.subfields[firstElement]["subfields"];
    let lastField = firstElement;
    arr.forEach((field) => {
      overwritten[field] =
        field && overwritten[field]
          ? overwritten[field]
          : { name: field, obj: new SubField(this.owner, field), subfields: {} };
      overwritten = overwritten[field]["subfields"];
      lastField = field;
    });
  }
}

class GraphNode{
  name: string;
  type: "expression_reference" | "scope_change" | "scope_change_rename" | "reassignment_reference" | "declaration";
  inputs: GraphNode[];
  outputs: { 
    expression_references: {[key: string]: GraphNode}; 
    in_scope_changes: {[key: string]: GraphNode}; 
    scope_changes: {[key: string]: GraphNode}; 
  };
  triggeredEvent?: EventType;
  id: string
  ASTNode?: ASTNode;
  ASTScope: ASTScope;

  constructor(name: string, type: GraphNode['type'], ASTScope: ASTScope, triggeredEvent?: EventType, ASTNode?: ASTNode){
    this.name = name
    this.inputs = []
    this.outputs = {expression_references: {}, in_scope_changes: {}, scope_changes: {}}
    this.type = type
    this.triggeredEvent = triggeredEvent
    this.ASTScope = ASTScope
    this.ASTNode = ASTNode
    if(ASTNode){
      ASTNode.node = this
    }
    this.id = getNewId().toString()
  }
  registerEvent(event: EventType){
    if (event.type === "expression_reference") {
      this.registerExpressionReferenceEvent(event)
    } else if (event.type === "scope_change_reference") {
      this.registerScopeChangeEvent(event)
    } else if (event.type === "in_scope_reference") {
      this.registerAssignmentReferenceEvent(event)
    }
  }
  addOutputsFromArrayOfNames(names: string[], event?: EventType){
    let currentNode: GraphNode = this
    while(names.length > 0){
      const newNodeName = names.pop() as string
      let newNode = currentNode.outputs.expression_references[newNodeName]
      if(!newNode){
        newNode = currentNode.addOutputsAndInput(
          newNodeName, 
          "expression_references",
          "expression_reference",
          this.ASTScope,
          event
        )
      }
      currentNode = newNode
    } 
    return currentNode  
  }
  registerExpressionReferenceEvent(event: EventType){
    const mutatableCompleteFromVar = [...event.memberExpressionAsArray].reverse()
    mutatableCompleteFromVar.pop()
    this.addOutputsFromArrayOfNames(mutatableCompleteFromVar, event)
  }
  addOutputsAndInput(name: string, where: keyof typeof this.outputs, type: typeof this.type, ASTScope: ASTScope,event?: EventType, ASTNode?: ASTNode){
    const newNode = new GraphNode(name, type, ASTScope, event, ASTNode)
    this.outputs[where][name] = newNode
    newNode.inputs.push(this)
    return newNode
  }
  attachOutputAndInput(node: GraphNode, where: keyof typeof this.outputs){
    this.outputs[where][node.name] = node
    node.inputs.push(this)
  }
  registerScopeChangeEvent(event: EventType){
    const mutatableCompleteFromVar = [...event.memberExpressionAsArray].reverse()
    mutatableCompleteFromVar.pop()
    const newScopeName = event.to_scope
    const newVarName = event.to_var || ''

    const lastNode = this.addOutputsFromArrayOfNames(mutatableCompleteFromVar, event)

    const scopeChangeNode = lastNode
    .addOutputsAndInput(newScopeName, "scope_changes", "scope_change", this.ASTScope, event, event?.to_obj || undefined)
    const newNode = scopeChangeNode.ASTNode?.processGraphNodes()
    if(newNode){
      scopeChangeNode.attachOutputAndInput(newNode, "scope_changes")
    }
  }
  registerAssignmentReferenceEvent(event: EventType){
    const mutatableCompleteFromVar = [...event.memberExpressionAsArray].reverse()
    mutatableCompleteFromVar.pop()
    const newVarName = event.to_var || ''

    const lastNode = this
    .addOutputsFromArrayOfNames(mutatableCompleteFromVar, event)
    .addOutputsAndInput(newVarName, "in_scope_changes", "reassignment_reference", this.ASTScope, event, event?.to_obj || undefined)
    const newNode = lastNode.ASTNode?.processGraphNodes()
    if(newNode){
      lastNode.attachOutputAndInput(newNode, "in_scope_changes")
    }
    
  }
  traverse(onNodeEnter: (node: GraphNode)=>void){
    Object.values(this.outputs).forEach(type => {
      Object.values(type).forEach(output => {
        onNodeEnter(output)
        output.traverse(onNodeEnter)
      })
    })
  }
  get reactFlowNode(){
    return ({
      id: this.id, 
      type: "CustomNode", 
      position: {x: 0, y: 0}, 
      data: {
        name: this.name, 
        type: this.type,
        inputs: [''],
        outputs: [''],
        fragment: this.ASTNode?.fragment,
        event: { ...this.triggeredEvent, to_obj: this.triggeredEvent?.to_obj?.name || "" }
      }
    })
  }
  get reactFlowEdges(){
    const edges: Edge[] = []
    let counter = 0
    Object.values(this.outputs).forEach(type => {
      Object.values(type).forEach(output => {
        edges.push({ 
          id: `edge-${this.name}-to-${output.name}-${counter}`, 
          //type: 'smoothstep',
          source: this.id, 
          target: output.id, 
          sourceHandle: `in-0`,
          targetHandle: `out-0`,
        })
        counter += 1
      })
    })
    return edges
  }
  getTraversedOutputsReactFlow(){
    const nodes = [this.reactFlowNode]
    const edges = [...this.reactFlowEdges]
    this.traverse(
      (node: GraphNode) => {
        nodes.push(node.reactFlowNode)
        edges.push(...node.reactFlowEdges)
      }
    )
    return {nodes, edges}
  }
}

class ASTNode {
  // main properties
  path: NodePath;
  uid: number;
  bindingIdentifiers: NodePath<Identifier>[] | null;

  // initialized variables
  tracked: boolean;
  name: string;
  fragment: FragmentType;
  fragmentType: string;

  // events and logs
  eventBus: EventType[];
  mergedEventBus: EventType[];
  recursiveDataDependency: string[][];
  inScopeEvents: EventType[];
  scopeChangeEvents: EventType[];
  rawUseEvents: EventType[];

  node: GraphNode;

  didEventBus: boolean;
  didDataDependency: boolean;
  didFragmentRecursiveGet: boolean;
  didProcessNodes:  boolean;
  references: NodePath[];
  scope: ASTScope;
  subfields: any; //{ [key: string]: SubField };
  typeEvents: { newArr: string[]; oldArr: string[]; finisher: NodePath; objectRef: any }[];

  constructor(
    path: NodePath,
    name: string,
    references: NodePath[],
    scope: ASTScope,
    tracked: boolean = false,
  ) {
    this.name = name;
    this.path = path;
    this.scope = scope;
    this.uid = this.path.getData("uid");
    this.bindingIdentifiers = Object.values(this.path.getBindingIdentifierPaths()) || null;
    this.fragmentType = "fragmenttype";
    this.fragment = {
      name: `${this.scope.name}_${this.fragmentType}`,
      contentObj: {},
      scopeContentObj: {},
      mergedContentObj: {},
      fragmentsReferences: [],
      value: "",
      scopeValue: "",
      mergedValue: "",
    };

    this.eventBus = [];
    this.mergedEventBus = [];
    this.recursiveDataDependency = [];
    this.tracked = tracked;

    this.inScopeEvents = [];
    this.scopeChangeEvents = [];
    this.rawUseEvents = [];
    this.didEventBus = false;
    this.didDataDependency = false;
    this.didFragmentRecursiveGet = false;
    this.didProcessNodes = false;

    this.references = references;
    this.subfields_two = this.tracked ? new SubField(this, this.name, null, true) : null;
    this.ancestry = this.path.getAncestry();
    this.location = this.path.getPathLocation();
    this.subfields = {};

    this.typeEvents = [];

    path.setData("ASTNode", this);
  }

  firstProcessingPhase() {
    if (!this.didEventBus) {
      this.references.forEach((ref: NodePath<Node>) => {
        const originName = this.name;
        const memberExpressionStringArray = this.getMemberExpressionAsArray(ref);
        while (
          memberExpressionStringArray[0] === "props" ||
          memberExpressionStringArray[0] === "this"
        ) {
          memberExpressionStringArray.shift();
        }

        /* if there was not an assigment neither a unpacking, just acknowledge it and add it bus
        i.e const returnMock = tracked.trackNum.MadeUpVariable + 1, because of the +1, it wont detect
        the variableDeclarator, and I guess it should not detect it. */
        this.mapRawReferences(memberExpressionStringArray, originName);
        // go back to check what type of node made this reference
        const rootMemberExpression = this.getRootOfMemberExpression(ref);
        const declarator = rootMemberExpression?.parentPath;
        if (!declarator || !rootMemberExpression) return;

        let typeEvent = null;
        ref.findParent((path) => {
          if (path.parentPath?.isObjectExpression()) {
            typeEvent = "objectExpression";
            return true;
          } else if (path.parentPath?.isCallExpression()) {
            typeEvent = "callExpression";
            return true;
          } else if (path.parentPath?.isVariableDeclarator()) {
            typeEvent = "variableDeclarator";
            return true;
          }
          return false;
        });
        if (typeEvent === "objectExpression" && memberExpressionStringArray.length > 0) {
          // get the whole path to this field
          const completeMemberExpressionAsArray: string[] = [];
          const memberExpressionArrayCopy = [...memberExpressionStringArray];
          if (memberExpressionArrayCopy[0] === this.name && !this.subfields[this.name])
            memberExpressionArrayCopy.shift();
          let objectRef = this.subfields[memberExpressionArrayCopy.shift() as string];
          if (objectRef) {
            while (memberExpressionArrayCopy.length > 0) {
              objectRef = objectRef[memberExpressionArrayCopy.shift() as string];
            }
          }

          rootMemberExpression.findParent((path) => {
            if (path.isCallExpression() || path.isVariableDeclarator()) {
              this.typeEvents.push({
                newArr: completeMemberExpressionAsArray.reverse(),
                oldArr: memberExpressionStringArray,
                finisher: path,
                objectRef: objectRef || null,
              });

              return true;
            }
            if (path.isObjectProperty() && !!path.node.key?.name) {
              completeMemberExpressionAsArray.push(path.node.key.name);
            }
            return false;
          });
        }

        if (declarator.isVariableDeclarator()) {
          /* If its declaring a variable, it means that its creating a new variable in memory 
					to store a subfield of the tracked variable. In this case, store an InScopeChange event 
					i.e: const z = tracked_variable.x.y , in case its an destructing (ObjectPattern) store it
					along its declaration name i.e: const { y } = tracked_variable.x */
          this.mapInScopeChanges(memberExpressionStringArray, declarator, originName);
        } else if (
          (rootMemberExpression.key !== "callee" && declarator.isCallExpression()) ||
          (declarator.isJSXExpressionContainer() && declarator.parentPath.isJSXAttribute())
        ) {
          this.mapScopeChanges(memberExpressionStringArray, rootMemberExpression, originName);
          // if (declarator.parentPath.isVariableDeclarator()) {
          //   this.mapInScopeChanges(memberExpressionStringArray, declarator.parentPath, originName);
          // }
        }
        //console.log(memberExpressionStringArray);
      });
      this.didEventBus = true;
      this.mergedEventBus = [...this.eventBus];

      if (this.eventBus.length > 0) {
        getLastObj(
          this.fragment.contentObj,
          this.eventBus.map((event) => event.memberExpressionAsArray),
        );
        getLastObj(
          this.fragment.scopeContentObj,
          this.eventBus.map((event) => event.memberExpressionAsArray),
        );
        this.fragment.value = this.processFragmentStringValue(this.fragment.contentObj);
      }
    }
  }
  processFragmentStringValue(contentObj: { [key: string]: any }) {
    const fragmentContent: string = JSON.stringify({...contentObj}, null, 2) || "";
    const formatedFragmentContent = fragmentContent.substring(1, fragmentContent.length - 1);
    return `fragment ${this.fragment.name} on ${this.fragmentType} {${formatedFragmentContent}}`
      .replace(/: {}/g, "")
      .replace(/,/g, "")
      .replace(/"/g, "")
      .replace(/: {/g, " {");
  }
  processRecursivePhase() {
    this.recursivelyGetDataDependencies();
    //this.recursivelyGetFragments();
    this.recursivelyGetFragments();
  }
  recursivelyGetFragments() {
    if (!this.didEventBus) {
      this.firstProcessingPhase();
    }
    
    const traverseContentObj = (searchResult: any, vars: string[]): any => {
      const varName = vars?.pop()
      if(!varName) return searchResult
      if(!searchResult[varName]) return null
      if(searchResult[varName]) {
        return traverseContentObj(searchResult[varName], vars)
      }
    }
    if (!this.didFragmentRecursiveGet && this.fragment.contentObj) {
      this.eventBus.forEach((event) => {
        
        const toObj = event.to_obj;
        if (toObj) {
          const toObjFragment = toObj.recursivelyGetFragments();

          if(event.type === 'scope_change_reference') {
            const vars = [...event.memberExpressionAsArray].reverse()
            const lastVar = vars.shift()
            
            const searchResult_local = traverseContentObj(this.fragment.contentObj, vars)
            searchResult_local[lastVar] = {...searchResult_local[lastVar], [`...${toObjFragment.name}`]: {}}
            
            const searchResult_scope = traverseContentObj(this.fragment.scopeContentObj, vars)
            searchResult_scope[lastVar] = {...searchResult_scope[lastVar], [`...${toObjFragment.name}`]: {}}
            
            this.fragment.fragmentsReferences.push(toObjFragment)
          } else if (event.type === 'in_scope_reference') {
            const vars = [...event.memberExpressionAsArray].reverse()
            event.to_var 
            && toObjFragment.scopeContentObj[event.to_var] 
            && Object.assign(
                traverseContentObj(this.fragment.scopeContentObj, vars), 
                JSON.parse(JSON.stringify(toObjFragment.scopeContentObj[event.to_var])
                )
              )
            this.fragment.fragmentsReferences = [
              ...this.fragment.fragmentsReferences,
              ...toObjFragment.fragmentsReferences,
            ];
          }
          
        }
      });
      getLastObj(this.fragment.mergedContentObj, this.recursiveDataDependency);
      this.fragment.value = this.processFragmentStringValue(this.fragment.contentObj);
      this.fragment.scopeValue = this.processFragmentStringValue(this.fragment.scopeContentObj);
      this.fragment.mergedValue = this.processFragmentStringValue(this.fragment.mergedContentObj);
    }

    this.didFragmentRecursiveGet = true;
    return this.fragment;
  }
  recursivelyGetDataDependencies(nameFilter?: string | null) {
    if (!this.didEventBus) {
      this.firstProcessingPhase();
    }
    if (this.typeEvents.length > 0) {
      this.typeEvents.forEach(({ newArr, finisher, objectRef }) => {
        if (finisher.isVariableDeclarator() && finisher.get("id").isIdentifier()) {
          const target = this.scope.getASTNodeBinding(finisher.node.id.name);
          if (target) target.registerSubFieldsFromArray(newArr, objectRef);
        }
      });
      this.typeEvents.forEach(({ finisher }) => {
        if (finisher.isVariableDeclarator() && finisher.get("id").isIdentifier()) {
          const target = this.scope.getASTNodeBinding(finisher.node.id.name);
          target?.firstProcessingPhase();
        }
      });
    }
    if (!this.didDataDependency) {
      this.didDataDependency = true;
      this.eventBus.forEach((event) => {
        const currentReference = event.memberExpressionAsArray;
        this.recursiveDataDependency.push(currentReference);
        if (event.to_obj) {
          const { dataDependency, mergedEvents } = event.to_obj.recursivelyGetDataDependencies(
            event.to_var,
          );
          this.mergedEventBus = [...this.mergedEventBus, ...mergedEvents];
          dataDependency.forEach((scopeChangedEvent) => {
            this.recursiveDataDependency.push(currentReference.concat(scopeChangedEvent.slice(1)));
          });
        }
      });
    }
    return {
      dataDependency: this.recursiveDataDependency.filter(
        nameFilter ? (_) => _.includes(nameFilter) : () => true,
      ),
      mergedEvents: this.mergedEventBus,
    };
  }
  processGraphNodes(){
    if (!this.didEventBus) {
      this.firstProcessingPhase();
    }
    this.node = new GraphNode(this.name, 'declaration', this.scope, null, this)
    if (!this.didProcessNodes) {
      this.eventBus.forEach((event) => {
        this.node.registerEvent(event)
      });
    }
    this.didProcessNodes = true;
    return this.node
  }
  getMemberExpressionAsArray(node: NodePath): string[] {
    const names: string[] = [];
    if (node.isIdentifier()) {
      if (
        node?.parentPath?.isMemberExpression() ||
        node?.parentPath?.isOptionalMemberExpression()
      ) {
        const rootNode = node.findParent(
          (node) =>
            !node.parentPath?.isMemberExpression() &&
            !node?.parentPath?.isOptionalMemberExpression(),
        );
        rootNode &&
          rootNode.traverse({
            enter(path) {
              if(path.isIdentifier()) { 
                names.push(path.node.name)
              } else if (path.isStringLiteral()) { 
                names.push(path.node.value)
              }
            },
          });
      } else {
        names.push(node.node.name);
      }
    }
    return names;
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
  getRootOfMemberExpression(node: NodePath) {
    if (node.isIdentifier() || node.isMemberExpression() || node.isOptionalMemberExpression()) {
      return node.parentPath.isMemberExpression() || node.isOptionalMemberExpression()
        ? node.findParent(
            (node) =>
              !node.parentPath?.isMemberExpression() &&
              !node.parentPath?.isOptionalMemberExpression(),
          )
        : node;
    }
    return null;
  }
  addEvent(event: EventType) {
    this.registerSubFieldsFromArray(event.memberExpressionAsArray);
    const id = Object.values(event).join("_");
    if (!this.eventBus.find((e) => e.id === id)) {
      if (event.type === "expression_reference") {
        this.rawUseEvents.push({ ...event, id });
      } else if (event.type === "in_scope_reference") {
        this.inScopeEvents.push({ ...event, id });
      } else if (event.type === "scope_change_reference") {
        this.scopeChangeEvents.push({ ...event, id });
      }
      this.eventBus.push({ ...event, id });
    }
  }
  mapRawReferences(memberExpressionStringArray: string[], originName: string) {
    const event = {
      type: "expression_reference",
      from_var: originName,
      to_var: null,
      to_obj: null,
      memberExpressionAsArray: memberExpressionStringArray,
      from_scope: this.path.scope.getData("name") || "",
      to_scope: this.path.scope.getData("name") || "",
    };
    this.addEvent(event);
  }
  registerSubFieldsFromArray(arr: string[], value: any = null) {
    const arrCopy = [...arr];
    if (arrCopy.length === 0) return;
    let firstElement = arrCopy.shift() || "";
    while (firstElement === this.name && arrCopy.length > 0) {
      firstElement = arrCopy.shift() || "";
    }
    if (firstElement === this.name) return;
    this.subfields[firstElement] =
      firstElement && this.subfields[firstElement] ? this.subfields[firstElement] : value || {};
    let overwritten = this.subfields[firstElement];
    arrCopy.forEach((field) => {
      overwritten[field] = field && overwritten[field] ? overwritten[field] : value || {};
      overwritten = overwritten[field];
    });
  }
  mapInScopeChanges(
    memberExpressionStringArray: string[],
    declarator: NodePath,
    originName: string,
  ) {
    const membersExpressions: string[][] = [];
    const declarations: NodePath<Identifier | ObjectProperty>[] = [];
    if (declarator.isVariableDeclarator()) {
      const declaratorId = declarator.get("id");
      if (declaratorId.isObjectPattern()) {
        const [unwrapedNames, objectProperties] = this.getObjectPatternAsArray(declaratorId);
        declarations.push(...objectProperties);
        membersExpressions.push(...unwrapedNames.map((n) => memberExpressionStringArray.concat(n)));
      } else if (declaratorId.isIdentifier()) {
        membersExpressions.push(memberExpressionStringArray);
        declarations.push(declaratorId);
      }
    }

    declarations.forEach((decl, i) => {
      const declaration = decl.isIdentifier() ? decl : decl.get("value");
      if (Array.isArray(declaration)) return;
      const declObj = decl.scope.getData("ASTScope").ASTNodes[declaration?.node?.name]; // decl.getData("ASTNode");

      if (declObj) {
        const event = {
          type: "in_scope_reference",
          from_var: originName,
          to_var: declObj.name,
          to_obj: declObj,
          memberExpressionAsArray: membersExpressions[i],
          from_scope: declObj.scope.name,
          to_scope: declObj.scope.name,
        };
        this.addEvent(event);
      } else {
        console.log(`could not find object ${declaration?.node?.name}`);
      }
    });
  }
  mapScopeChanges(memberExpressionStringArray: string[], rootNode: NodePath, originName: string) {
    const statement = rootNode.parentPath;
    if (!statement) return;
    const event: EventType = {
      type: "scope_change_reference",
      from_var: originName,
      to_var: "",
      to_obj: null,
      memberExpressionAsArray: memberExpressionStringArray,
      from_scope: rootNode.scope.getData("ASTScope").name || "",
      to_scope: "",
    };
    if (statement.isCallExpression()) {
      const rootKey = rootNode.key;
      let toScope: NodePath = statement.get("callee");
      if (
        (toScope.isMemberExpression() || toScope.isOptionalMemberExpression()) &&
        toScope.get("property").isIdentifier()
      ) {
        toScope = toScope.get("property");
      }
      if (toScope.isIdentifier()) {
        event["to_scope"] = toScope.node.name;
        const toScopeBinding = this.scope.getASTScope(toScope.node.name); // rootNode.scope.getBinding(callee.node.name) || {
        if (toScopeBinding && typeof rootKey === "number") {
          const params = toScopeBinding.path.get("params");
          const target = Array.isArray(params) ? params[rootKey] : params;
          if (target.isIdentifier()) {
            event["to_var"] = target.node.name;
            event["to_obj"] = target.scope.getData("ASTScope").getASTNodeBinding(target.node.name);
            this.addEvent(event);
            return;
          }
        }
        event["to_var"] = `could not find scope ${toScope.node.name}`;
        this.addEvent(event);
      }
    } else if (statement.isJSXExpressionContainer()) {
      const openingNode: NodePath<JSXOpeningElement> | null = rootNode.findParent((node) =>
        node.isJSXOpeningElement(),
      ) as NodePath<JSXOpeningElement>;
      const newName =
        statement.parentPath.isJSXAttribute() && statement.parentPath.get("name").node.name;

      if (openingNode && newName && typeof newName === "string") {
        const _openingName = openingNode.get("name");
        const openingName =
          !Array.isArray(_openingName) && _openingName?.isJSXIdentifier() && _openingName.node.name;
        if (openingName) {
          const toScopeBinding = this.scope.getASTScope(openingName);
          if (toScopeBinding) {
            event["to_var"] = newName;
            event["to_obj"] = toScopeBinding.getASTNodeBinding(newName);
            event["to_scope"] = openingName;
            this.addEvent(event);
            return;
          }
        }
      }
    }
  }
  get eventBusJsonSafe() {
    return this.eventBus.map((event) => ({ ...event, to_obj: event?.to_obj?.name || "" }));
  }
}

class ASTScope {
  scope: Scope;
  ASTNode: ASTNode | null;
  path: NodePath;
  uid: number;
  name: string;
  aliasName: string;
  type: string;
  parent: ASTScope | null;
  ScopeReferencesAndAssignments: {
    references: { [key: string]: NodePath[] };
    assignments: { [key: string]: NodePath };
  };
  scopeAfterProgram: ASTScope | null | undefined; // this variable hold a reference to the scope at the most top level, only bellow the program itself (useful to locate component scope)
  ASTNodes: { [name: string]: ASTNode };
  childScopes: ASTScope[];
  trackedVars: string[];
  imports: {[name: string]: {realName: string, localName: string, ASTScope: ASTScope | null, codeImportedSuccess: boolean, code: string | null, getASTScopeFromCodeFn: ()=>ASTNode | null}}
  fragment: {
    name: string,
    spreads: {[name: string]: string},
    contentObj: any,
    mergedContentObj: any,
    fragmentString: string,
    mergedFragmentString: string,
  }
  exported: boolean;
  defaultExported: boolean;

  constructor(scope: Scope, uid: number, parent: ASTScope | null = null) {
    this.scope = scope;
    this.path = scope.path;

    this.exported = this.path.parentPath?.isExportNamedDeclaration() || false
    this.defaultExported = this.path.parentPath?.isExportDefaultDeclaration() || false

    if (this.path.isClassMethod()) {
      this.name = this.path.node.key?.name;
    } else if (
      this.path.isArrowFunctionExpression() &&
      this.path.parentPath.isVariableDeclarator()
    ) {
      this.name = this.path.parent.id?.name;
    } else {
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
    this.ASTNode = this.parent?.getASTNodeBinding(this.name) || null;

    this.ASTNodes = {};

    this.scope.setData("ASTScope", this);
    this.scope.setData("name", this.name);

    if (this.parent) this.parent.childScopes.push(this);
    
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
      mergedContentObj: {},
      fragmentString: '',
      mergedFragmentString: '',
    }
  }
  registerThisReference(ref: NodePath<ThisExpression>) {
    const parentExpression = ref.findParent(
      (path) => !path.isMemberExpression() && !path.isOptionalMemberExpression(),
    );
    const rootExpression = ref.findParent(
      (path) =>
        !path.parentPath?.isMemberExpression() && !path.parentPath?.isOptionalMemberExpression(),
    );
    const thisExpressionParent = ref.parentPath;
    let pathToRegister: NodePath<Identifier> | null = null;
    if (!parentExpression || !rootExpression || !thisExpressionParent) return;
    // if the this usage is in the right side of a variable declaration...
    if (parentExpression.isVariableDeclarator()) {
      //if key is init, it is a reference
      if (rootExpression.key === "init") {
        // register as reference the next var name after this or props
        // i.e const some_var = this.props.tracked_var ---> this should mark a reference to tracked_var
        // if its only a this and not a member expression, dont register anything --> i.e const some_var = this
        // if its a member expression, only register if the property of that member expression is not props ---> const some_var = this.props
        // if whats after this is props ----> i.e this.props ----> check if there is more after props
        if (
          (thisExpressionParent.isMemberExpression() ||
            thisExpressionParent.isOptionalMemberExpression()) &&
          (thisExpressionParent.get("property").node?.name !== "props" ||
            (thisExpressionParent.get("property").node?.name === "props" &&
              (thisExpressionParent.parentPath.isMemberExpression() ||
                thisExpressionParent.parentPath.isOptionalMemberExpression())))
        ) {
          // if got here, means that its either something like const   some_var = this.props.tracked_var  OR  some_var = this.tracked_var
          const property =
            thisExpressionParent.get("property").node?.name === "props"
              ? thisExpressionParent.parentPath.get("property")
              : thisExpressionParent.get("property");
          pathToRegister = !Array.isArray(property) && property.isIdentifier() ? property : null;
        } else {
          const declaratorId = parentExpression.get("id");
          if (!Array.isArray(declaratorId)) {
            if (declaratorId.isObjectPattern()) {
              // if got here its either const { tracked_var } = this or this.props
              // register as reference the var name after this or props, if there isnt, register the object destructured
              // i.e const { tracked_var } = this.props ---> this should mark a reference to tracked_var
              // i.e const { subField } = this.props.tracked_var ---> this should mark a reference only to tracked_var
              pathToRegister = declaratorId.get("properties")[0].get("key");
            }
          }
        }
      }
    } else if (parentExpression.isAssignmentExpression()) {
      // i.e  this.some_var = something ----> register as assignment only (or do nothing and register only on its reference)
    } else {
      pathToRegister =
        ref.parentPath.node.property.name !== "props"
          ? ref.parentPath.get("property")
          : ref?.parentPath?.parentPath?.get("property");
    }
    if (!pathToRegister || !pathToRegister.node) return;
    
    if (pathToRegister.node.name && !this.ScopeReferencesAndAssignments.assignments[pathToRegister.node.name])
      this.ScopeReferencesAndAssignments.assignments[pathToRegister.node.name] = pathToRegister;
    const owner = this.getRootOfMemberExpression(pathToRegister)?.parentPath;
    if (!owner?.isAssignmentExpression()) {
      this.ScopeReferencesAndAssignments.references[pathToRegister.node.name] = this
        .ScopeReferencesAndAssignments.references[pathToRegister.node.name]
        ? [
            ...this.ScopeReferencesAndAssignments.references[pathToRegister.node.name],
            pathToRegister,
          ]
        : [pathToRegister];
    }
    this.ScopeReferencesAndAssignments.references[pathToRegister.node.name] = [
      ...this.ScopeReferencesAndAssignments.references[pathToRegister.node.name],
      ...pathToRegister.scope.bindings[pathToRegister.node.name]?.referencePaths || []
    ]
  }
  getASTNodeBinding(nodeName: string): ASTNode | null {
    let astNode: ASTNode | null = null;
    let currentScope: ASTScope | null = this;
    while (currentScope !== null && astNode === null) {
      currentScope && currentScope.ASTNodes[nodeName]
        ? (astNode = currentScope.ASTNodes[nodeName])
        : (currentScope = currentScope?.parent || null);
    }
    return astNode;
  }
  getASTScope(scopeName: string): ASTScope | null {
    let astScope: ASTScope | null = null;
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
    // import changes
    
    return astScope;
  }
  bindImportToLocalCode(imported: typeof this.imports['value']){
    // if(this.type === 'Program'){
    //   this.childScopes.forEach(scope => {
    //     if(scope.type === 'Program') {
    //       imported.ASTScope = scope.getASTScope(key) || null
    //       if(imported.ASTScope){
    //         this.childScopes.push(imported.ASTScope)
    //       }
          
    //     }
    //   })
    // }
    // if(imported.ASTScope){
    //   this.childScopes.push(imported.ASTScope)
    // } 
    
  }
  processReferences() {
    // Object.keys(this.imports).forEach(imported => {
    //   this.bindImportToLocalCode(this.imports[imported])
    // })
    Object.entries(this.scope.bindings).forEach(([name, bind]) => {
      this.ScopeReferencesAndAssignments.assignments[name] = bind.path;
      this.ScopeReferencesAndAssignments.references[name] = this.ScopeReferencesAndAssignments
        .references[name]
        ? [...this.ScopeReferencesAndAssignments.references[name], ...bind.referencePaths]
        : bind.referencePaths;
      if (name === "props") {
        bind.referencePaths.forEach((ref) => {
          // if its member expression i.e const some_var = props.tracked_var ----> register a reference to tracked_var
          if (
            ref.parentPath?.isMemberExpression() ||
            ref.parentPath?.isOptionalMemberExpression()
          ) {
            const varRef = ref.parentPath.get("property");
            const varRefName = varRef.node?.name || varRef.node?.value;
            if (varRefName && typeof varRefName === "string") {
              if (!this.ScopeReferencesAndAssignments.assignments[varRefName])
                this.ScopeReferencesAndAssignments.assignments[varRefName] = varRef;
              this.ScopeReferencesAndAssignments.references[varRefName] = this
                .ScopeReferencesAndAssignments.references[varRefName]
                ? [...this.ScopeReferencesAndAssignments.references[varRefName], varRef]
                : [varRef];
            }
          }
        });
      }
    });
    Object.entries(this.ScopeReferencesAndAssignments.assignments).map(([name, path]) => {
      this.ASTNodes[name] = new ASTNode(
        path,
        name,
        this.ScopeReferencesAndAssignments.references[name],
        this,
        !!path.getData("tracked") || !!this.trackedVars.find((trackedVar) => trackedVar === name),
      );
    });
  }
  getRootOfMemberExpression(node: NodePath) {
    if (node.isIdentifier() || node.isMemberExpression() || node.isOptionalMemberExpression()) {
      return node.parentPath.isMemberExpression() || node.isOptionalMemberExpression()
        ? node.findParent(
            (node) =>
              !node.parentPath?.isMemberExpression() &&
              !node.parentPath?.isOptionalMemberExpression(),
          )
        : node;
    }
    return null;
  }
  secondPhaseProcess() {
    const trackedNode = Object.values(this.ASTNodes).find((node) => node.tracked);
    if (trackedNode) {
      const trackedNodeContent = trackedNode.subfields;
    }
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

// const processImports = (ast: File) => {
//   const processImportPath = (importPath: string, nodePath?: string) => {
//     const paths = importPath.split("/")
//     if (paths[0] === '.' && nodePath){
//       const newPath = nodePath.split("/")
//       newPath.pop()
//       paths.shift()
//       return [...newPath, paths].join("/")
//     } else if (paths[0] === '@'){
//       return importPath
//     }
//     return importPath
//   }
//   const files: {[key: string]: string} = {}
//   function recursiveGetASTs(ast: Program){
//     const imports: {[key: string]: {name: string, path: string, content?: Node}} = {}
//     const exports: {[key: string]: {name: null | string, path: string, content?: Node}} = {}
//     const others: {[key: string]: {name: null | string, path: string, content?: Node}} = {}
//     if(ast){
//       ast.body.forEach(path => {
//         if (path.type === 'ImportDeclaration') {
//           const importPath = processImportPath(path.source.value, path.loc?.filename)
          
//           path.specifiers.forEach((imported) => {
//             if (imported.type === 'ImportDefaultSpecifier'){
//               imports[imported.local.name] = {name: imported.local.name, path: importPath}
//             } else if (imported.type === 'ImportSpecifier') {
//               imports[imported.imported.type === 'Identifier' 
//               ? imported.imported.name 
//               : imported.imported.value] = {
//                 name: imported.local.name, 
//                 path: importPath
//               }
//             }
//           })
//         }
//         else if(path.type === 'ExportNamedDeclaration'){
//           if(path.declaration){
//             if(path.declaration.id && path.declaration.id.name){
//               exports[path.declaration.id.name] = {
//                 name: path.declaration.id.name,
//                 path: '',
//                 content: path.declaration
//               }
//             }
//           } else if (path.specifiers.length > 0){
//             path.specifiers.forEach(exported => {
//               exports[exported.exported.type === 'Identifier' ? exported.exported.name : exported.exported.value] = {
//                 name: exported.local.name,
//                 path: '',
//                 content: ast.body.find(node => 'id' in node && node.id && 'name' in node.id && node.id.name === exported.local.name)
//               }
//             })
//           }
//         }
//         else if(path.type === 'ExportDefaultDeclaration'){
//           if(path.declaration){
//             if(path.declaration.type === 'Identifier'){
//               exports['default'] = {
//                 name: path.declaration.name,
//                 path: '',
//                 content: ast.body.find(node => 'id' in node && node.id && 'name' in node.id && node.id.name === path.declaration.name)
//               }
//             } else if ('id' in path.declaration && path.declaration.id && path.declaration.id.type === 'Identifier') {
//               exports['default'] = {
//                 name: path.declaration.id.name,
//                 path: '',
//                 content: path.declaration
//               }
//             } else {
//               exports['default'] = {
//                 name: null,
//                 path: '',
//                 content: path.declaration
//               }
//             }
//           }
//         }
//         else if(path.type === 'ClassDeclaration' || path.type === 'FunctionDeclaration'){
//           if(path.id?.name){
//             exports[path.id.name] = {
//               name: path.id.name,
//               path: '',
//               content: path
//             }
//           }
//         }
//       })
      
//     }
//     console.log('imports')
//     console.log(imports)
//     console.log('exports')
//     console.log(exports)
//     Object.keys(imports).forEach(key => {
//       const imported = imports[key]
//       const newImportPath = imported.path
//       readFileFromLocal(newImportPath).then(code => {
//         if(code){
//           const ast = parse(code, {
//             sourceType: "module",
//             sourceFilename: newImportPath,
//             plugins: [
//               // enable jsx and flow syntax
//               "jsx",
//               "flow",
//             ],
//           });
//           if(ast){
//             const importedVars = recursiveGetASTs(ast.program)
//             Object.keys(importedVars).forEach(declaration => {
//               if(imports[declaration]){
//                 imports[declaration].content = importedVars[declaration].content
//               } else if(importedVars[declaration].name){
//                 imports[declaration] = {...importedVars[declaration], path: newImportPath}
//               }
//             })
//           }
//         }
//       })
//     })
//     return exports
//   }
//   console.log('got here')
//   recursiveGetASTs(ast.program)

// }


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
  const allASTNodes: ASTNode[] = [];
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
    const trackedVariables: ASTNode[] = [];
    const nodes: ASTNode[] = [];
    const scopes: ASTScope[] = [];
    const scopeQueue: ASTScope[] = [];
    const variableDeclaration: NodePath[] = [];
    const trackeds: { scope: Scope; varName: string }[] = [];
    let currentScope: ASTScope | null | undefined

    const processOnEnterPath = (path: NodePath) => {
      if (path.isScope()) {
        const newScope = new ASTScope(path.scope, scopes.length, scopeQueue[scopeQueue.length - 1]);
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
          trackeds.push({ scope: path.scope, varName: trackedName });
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
          path.get("declarations").forEach((decl) => decl.setData("tracked", true));
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
    trackeds.forEach(({ scope, varName }) => {
      scope.getData("ASTScope").trackedVars.push(varName);
    });
    scopes.forEach((scope) => {
      scope.processReferences();
      Object.values(scope.ASTNodes).forEach((node) => {
        allASTNodes.push(node);
        node.tracked && trackedVariables.push(node);
        //trackedVariables.push(node);
      });
    });
    trackedVariables.forEach((_) => {
      _.firstProcessingPhase();
      _.processRecursivePhase();
      _.processGraphNodes();
    });
    return {scopes, nodes, trackedVariables}
  }

  const {scopes, nodes, trackedVariables} = processASTIntoScopes(ast)

  const isClient = typeof window === "undefined" ? false : true;
  if (isClient) {
    console.log(nodes.filter((node) => node.path.isVariableDeclarator()));
    console.log(scopes.map(({ scope }) => scope));
    console.log(scopes);
    console.log(trackedVariables);
  }
  return trackedVariables.map(({ fragment, mergedEventBus, name, recursiveDataDependency, node }) => ({
    eventBus: mergedEventBus.map((e) => ({ ...e, to_obj: e?.to_obj?.name || "" })),
    fragment,
    name,
    recursiveDataDependency,
    node: node.getTraversedOutputsReactFlow(),
  }));

  // return allASTNodes
  //   .filter((node) => node.eventBus.length > 0)
  //   .map(({ fragment, eventBus, name, recursiveDataDependency }) => ({
  //     eventBus: eventBus.map((e) => ({ ...e, to_obj: e?.to_obj?.name || "" })),
  //     fragment,
  //     name,
  //     recursiveDataDependency,
  //   }));
}

