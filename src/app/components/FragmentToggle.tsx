import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useRef, useState } from "react"

const processFragmentStringValue = (contentObj: {[key: string]: any}, name: string, fragmentType?: string) => {
  const fragmentContent: string = JSON.stringify({...contentObj}, null, 2) || "";
  const formatedFragmentContent = fragmentContent.substring(1, fragmentContent.length - 1);
  return `fragment ${name} on ${fragmentType || 'fragmentType'} {${formatedFragmentContent}}`
    .replace(/: {}/g, "")
    .replace(/,/g, "")
    .replace(/"/g, "")
    .replace(/: {/g, " {");
}

const processFragmentAndSpreadsToStringValue = (contentObj: {[key: string]: any}, name: string, spreads: {[key: string]: any}, fragmentType?: string) => {
  const untoggledSpreads: string[] = []
  turnObjToArrayOfMemberExpressions(contentObj).forEach(line => line.forEach(variable => new Set(Object.keys(spreads)).has(variable) && untoggledSpreads.push(variable) ))
  const result = processFragmentStringValue(contentObj, name, fragmentType)
  return result + '\n\n' + untoggledSpreads.map(spread => processFragmentStringValue(spreads[spread], spread.slice(3))).join('\n\n')
}

const turnObjToArrayOfMemberExpressions = (obj: {[key: string]: any}): string[][] => {
  const traverse = (obj: {[key: string]: any}, currentMemberExpression: string[]): string[][] => {
    const returnArr: string[][] = []
    if(Object.keys(obj).length > 0){
      Object.keys(obj).forEach(key => returnArr.push(...traverse(obj[key], [...currentMemberExpression, key])))
      return returnArr
    } else {
      return [currentMemberExpression]
    }
  }
  const arr: string[][] = []
  Object.keys(obj).forEach(key => arr.push(...traverse(obj[key], [key])))
  return arr
}

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

const exchanceFragmentSpreadForFragmentValue = (obj: {[key: string]: any}, spreadNames: Set<string>, spreads: {[key: string]: any}) => {
  const mutatableSpreadNames = new Set(spreadNames)
  let resultArr: string[][] = turnObjToArrayOfMemberExpressions(obj)
  let loop = true
  while(loop){
    const arr: string[][] = []
    let foundSpreadOnThisIteration = false
    loop = false
    resultArr.forEach(memberExpression => {
      if(mutatableSpreadNames.has(memberExpression[memberExpression.length-1])){
        foundSpreadOnThisIteration = true
        const savedMemberExpression = [...memberExpression]
        const spreadName = savedMemberExpression.pop() as string
        
        const spreadValueArr = turnObjToArrayOfMemberExpressions(spreads[spreadName])
  
        spreadValueArr.length > 0 ? spreadValueArr.forEach(memberExpression => {
          arr.push([...savedMemberExpression, ...memberExpression])
        }) : arr.push([...savedMemberExpression])
      } else {
        arr.push(memberExpression)
      }
    })
    if(foundSpreadOnThisIteration){
      loop = true
    }
    resultArr = [...arr]
  }
  
  return turnArrayIntoObject(resultArr)
}

export default function FragmentToggle({contentObj, spreads, fragmentName}: {contentObj: {[key: string]: any}, spreads: {[key: string]: any}, fragmentName: string}){
  const initialContentObj = useRef(contentObj)
  const toggledSpreads = useRef<Set<string>>(new Set())
  const [currentContentObj, setCurrentContentObj] = useState(contentObj)

  const toggleFragment = (spreadName: string) => {
    toggledSpreads.current.has(spreadName) ? toggledSpreads.current.delete(spreadName) : toggledSpreads.current.add(spreadName)
    const newContentObj = exchanceFragmentSpreadForFragmentValue(initialContentObj.current, toggledSpreads.current, spreads)
    setCurrentContentObj(newContentObj)
  }

  return (
    <div className='flex flex-col gap-1 w-full'>
      <ScrollArea className="whitespace-nowrap rounded-md border">
        <div className="flex w-max space-x-4 p-4">
          {Object.keys(spreads).map((spread) => (
            <div className="overflow-hidden rounded-md" key={spread}>
              <Toggle onPressedChange={() => toggleFragment(spread)}>{spread}</Toggle>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      
      <div> 
        {<Textarea rows={18} value={processFragmentAndSpreadsToStringValue(currentContentObj, fragmentName, spreads)} readOnly />}
      </div>
    </div>
   
  )
}