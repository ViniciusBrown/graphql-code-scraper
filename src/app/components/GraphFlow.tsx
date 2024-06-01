"use client"
import React, { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Edge,
  Node,
  Connection,
  OnNodesChange,
  OnEdgesChange,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import CustomNode from './GraphNode';
import dagre from 'dagre';
import { Button } from '@/components/ui/button';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 200;
const nodeHeight = 50;

const padding = 20

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: (node.width || nodeWidth)+padding, height: (node.height || nodeHeight)+padding });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = isHorizontal ? 'left' : 'top';
    node.sourcePosition = isHorizontal ? 'right' : 'bottom';

    // We are shifting the dagre node position (anchor=center center) to the top left
    // so it matches the React Flow node anchor point (top left).
    node.position = {
      x: nodeWithPosition.x - (node.width || nodeWidth) / 2,
      y: nodeWithPosition.y - (node.height || nodeHeight) / 2,
    };

    return node;
  });

  return { nodes, edges };
};

 
// const initialNodes_mock = [
//   { id: '1', type: "CustomNode", position: { x: 0, y: 0 }, data: { label: '1' } },
//   { id: '2', type: "CustomNode", position: { x: 0, y: 100 }, data: { label: '2' } },
// ];
// const initialEdges_mock = [{ id: 'e1-2', source: '1', target: '2' }];

type Props = {
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node<any, string | undefined>[]>>;
  onNodesChange: OnNodesChange;
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge<any>[]>>;
  onEdgesChange: OnEdgesChange;
}

const nodeTypes = { CustomNode };

export default function GraphFlow({nodes, setNodes, onNodesChange, edges, setEdges, onEdgesChange}: Props) {
  const [captureElementClick, setCaptureElementClick] = useState(true);
  // const onConnect = useCallback(
  //   (params: Edge<any> | Connection) => setEdges((eds) => addEdge(params, eds)),
  //   [setEdges],
  // );

  const onLayout = useCallback(
    (direction: string) => {
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        nodes,
        edges,
        direction
      );

      setNodes([...layoutedNodes]);
      setEdges([...layoutedEdges]);
    },
    [nodes, edges]
  );

  const onNodeClick = (event, node) => console.log('click node', node);
 
  return (
    <div style={{ height: '430px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={captureElementClick ? onNodeClick : undefined}
        nodeTypes={nodeTypes}
        fitView
      >
        <Panel position="top-right">
          <Button onClick={() => onLayout('LR')}>Refresh</Button>
        </Panel>
        <Controls />
        <MiniMap />
        <Background variant="dots" gap={12} size={1} />
      </ReactFlow>
    </div>
  );
}