import { Label } from '@/components/ui/label';
import { useCallback } from 'react';
import { Handle, Node, Position } from 'reactflow';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

import FragmentToggle from './FragmentToggle';

const handleStyle = { top: 10 };

const padding = 10
const margin = 4

export type GraphNodeDataType = {
	inputs: string[], outputs: string[], type: string, name: string, fragment: string, spreads: {[key: string]: string}
}

const getColor = (type: string, label: boolean) =>{
	switch (type) {
		case "expression_reference":
			return ({
				backgroundColor: label ? '#0000ff' : '#92c9ff'
			})
		case "scope_change":
			return ({
				backgroundColor: label ? '#ff0000' : '#ff6347'
			}) 
		case "reassignment_reference":
			return ({
				backgroundColor: label ? '#3cb371' : '#84ee85'
			}) 
		case "declaration":
			return ({
				backgroundColor: label ? '#f0a600' : '#f0c100'
			}) 
			
			
		default:
			return ({
				backgroundColor: 'grey'
			})
			break;
	}
}

export default function CustomNode({ data, id }: {data: GraphNodeDataType, id: Node<any, string | undefined>['id']}) {
  const { inputs, outputs, type, name, fragment, spreads, contentObj } = data
	// const labelHeight = document.getElementById('label')?.clientHeight || 0;
	
	const GetNode = () => {
		return (
			<div style={getColor(type, false)} className="rounded-md border-2 border-slate-300">
				<div id="label" style={getColor(type, true)} className='flex flex-col justify-center rounded-t-md h-[16px]'>
					<h1 className='text-[12px] mx-2 text-white self-center'>{type}</h1>
				</div>
				<div className="flex flex-row min-h-[30px] justify-between">
					<div className="flex flex-col justify-center mr-1">
						{inputs.map((input, i)  => 
								<div className="flex flex-row items-center" key={input}>
									<Handle id={`in-${i}`} type="target" style={{position: "relative", top:3}}  position={Position.Left} className="self-center"/>
									<Label className="self-center text-sm text-white">{input}</Label>
								</div>
							)}
					</div>
					<Label className="self-center text-sm text-white">{name}</Label>
					<div className="flex flex-col justify-center ml-1">
						{outputs.map((output, i)  => 
								<div className="flex flex-row items-center justify-end" key={output}>
									<Label className="self-center text-sm text-white">{output}</Label>
									<Handle id={`out-${i}`} type="source" style={{position: "relative", top:3}} position={Position.Right} className=""/>
								</div>
							)}
					</div>
				</div>
			</div>
		)
	}
	const AlertWrappedNode = () => {
		return (
			<AlertDialog>
				<AlertDialogTrigger>
						{GetNode()}
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Fragment</AlertDialogTitle>
						<AlertDialogDescription>
							<Tabs defaultValue="spread_fragment" className=" w-[460px] h-[500px]">
								<TabsList>
									<TabsTrigger value="spread_fragment">Spread Fragment</TabsTrigger>
									<TabsTrigger value="full_fragment">Full Fragment</TabsTrigger>
								</TabsList>
								<TabsContent value="full_fragment">
									{fragment.split('\n').map(line => <pre key={line}>{line}</pre>)}
									{/* <Textarea rows={20} key={name} value={fragment} readOnly /> */}
									{/* {fragment && (fragment.mergedValue) && <Textarea rows={20} key={name} value={fragment.mergedValue} readOnly />} */}
								</TabsContent>
								<TabsContent value="spread_fragment">
									<FragmentToggle contentObj={contentObj} spreads={spreads} fragmentName={name} />
									{/* {fragment.split('\n').map(line => <pre key={line}>{line}</pre>)} */}
									{/* {<Textarea rows={20} key={name} value={fragment} readOnly />} */}
									{/* {fragment && (fragment.scopeValue) && <Textarea rows={20} key={name} value={fragment.scopeValue+'\n\n'+fragment.fragmentsReferences.map(ref => ref.scopeValue).join('\n\n')} readOnly />} */}
								</TabsContent>
							</Tabs>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction>Exit</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		)
	}
  return (
		<div>	
			{type === 'scope_change' || type === 'declaration' ? AlertWrappedNode() : GetNode()}
		</div>
  );
}
