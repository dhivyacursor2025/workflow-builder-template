"use client";

import { useAtom, useAtomValue } from "jotai";
import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import {
  currentWorkflowIdAtom,
  currentWorkflowNameAtom,
  edgesAtom,
  isGeneratingAtom,
  nodesAtom,
  selectedNodeAtom,
} from "@/lib/workflow-store";

type AIPromptProps = {
  workflowId?: string;
  onWorkflowCreated?: (workflowId: string) => void;
};

export function AIPrompt({ workflowId, onWorkflowCreated }: AIPromptProps) {
  const [isGenerating, setIsGenerating] = useAtom(isGeneratingAtom);
  const [prompt, setPrompt] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodes = useAtomValue(nodesAtom);
  const [edges, setEdges] = useAtom(edgesAtom);
  const [_nodes, setNodes] = useAtom(nodesAtom);
  const [_currentWorkflowId, setCurrentWorkflowId] = useAtom(currentWorkflowIdAtom);
  const [_currentWorkflowName, setCurrentWorkflowName] = useAtom(currentWorkflowNameAtom);
  const [_selectedNodeId, setSelectedNodeId] = useAtom(selectedNodeAtom);

  // Filter out placeholder "add" nodes to get real nodes
  const realNodes = nodes.filter((node) => node.type !== "add");
  const hasNodes = realNodes.length > 0;

  // Focus input when Cmd/Ctrl + K is pressed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleFocus = () => {
    setIsExpanded(true);
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (!prompt.trim()) {
      setIsExpanded(false);
    }
  };

  const handleGenerate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      
      if (!prompt.trim() || isGenerating) {
        return;
      }

      setIsGenerating(true);

      try {
        // Send existing workflow data for context when modifying
        const existingWorkflow = hasNodes
          ? { nodes: realNodes, edges, name: _currentWorkflowName }
          : undefined;
        
        console.log("[AI Prompt] Generating workflow");
        console.log("[AI Prompt] Has nodes:", hasNodes);
        console.log("[AI Prompt] Sending existing workflow:", !!existingWorkflow);
        if (existingWorkflow) {
          console.log(
            "[AI Prompt] Existing workflow:",
            existingWorkflow.nodes.length,
            "nodes,",
            existingWorkflow.edges.length,
            "edges"
          );
        }
        
        const workflowData = await api.ai.generate(prompt, existingWorkflow);
        
        console.log("[AI Prompt] Received workflow data");
        console.log("[AI Prompt] Nodes:", workflowData.nodes?.length || 0);
        console.log("[AI Prompt] Edges:", workflowData.edges?.length || 0);

        // Ensure all edges use the animated type to match manual connections
        const edgesWithAnimatedType = (workflowData.edges || []).map((edge) => ({
          ...edge,
          type: "animated",
        }));

        // Validate: ensure only ONE trigger node exists
        const triggerNodes = (workflowData.nodes || []).filter(
          (node) => node.data?.type === "trigger"
        );
        
        let validEdges = edgesWithAnimatedType;
        
        if (triggerNodes.length > 1) {
          console.warn(
            `[AI Prompt] AI generated ${triggerNodes.length} triggers. Keeping only the first one.`
          );
          
          // Keep only the first trigger and all non-trigger nodes
          const firstTrigger = triggerNodes[0];
          const nonTriggerNodes = (workflowData.nodes || []).filter(
            (node) => node.data?.type !== "trigger"
          );
          workflowData.nodes = [firstTrigger, ...nonTriggerNodes];
          
          // Remove edges connected to removed triggers
          const removedTriggerIds = triggerNodes.slice(1).map((n) => n.id);
          validEdges = edgesWithAnimatedType.filter(
            (edge) =>
              !removedTriggerIds.includes(edge.source) &&
              !removedTriggerIds.includes(edge.target)
          );
          
          toast.warning("Removed extra triggers (workflows can only have 1 trigger)");
        }

        // Validate: check for blank/incomplete nodes
        console.log("[AI Prompt] Validating nodes:", workflowData.nodes);
        const incompleteNodes = (workflowData.nodes || []).filter((node) => {
          const nodeType = node.data?.type;
          const config = node.data?.config || {};
          
          console.log(`[AI Prompt] Checking node ${node.id}:`, {
            type: nodeType,
            config,
            hasActionType: !!config.actionType,
            hasTriggerType: !!config.triggerType,
          });
          
          // Check trigger nodes
          if (nodeType === "trigger") {
            return !config.triggerType;
          }
          
          // Check action nodes
          if (nodeType === "action") {
            return !config.actionType;
          }
          
          // Allow other node types (condition, transform) without strict validation
          return false;
        });

        if (incompleteNodes.length > 0) {
          console.error(
            "[AI Prompt] AI generated incomplete nodes:",
            incompleteNodes
          );
          console.error(
            "[AI Prompt] Full workflow data:",
            JSON.stringify(workflowData, null, 2)
          );
          throw new Error(
            `Cannot create workflow: The AI tried to create ${incompleteNodes.length} incomplete node(s). The requested action type may not be supported. Please try a different description using supported actions: Send Email, Send Slack Message, Create Ticket, Database Query, HTTP Request, Generate Text, or Generate Image.`
          );
        }

        // If no workflowId, create a new workflow
        if (!workflowId) {
          const newWorkflow = await api.workflow.create({
            name: workflowData.name || "AI Generated Workflow",
            description: workflowData.description || "",
            nodes: workflowData.nodes || [],
            edges: validEdges,
          });

          setNodes(workflowData.nodes || []);
          setEdges(validEdges);
          setCurrentWorkflowId(newWorkflow.id);
          setCurrentWorkflowName(workflowData.name || "AI Generated Workflow");
          
          toast.success("Created workflow");
          
          // Notify parent component to redirect
          if (onWorkflowCreated) {
            onWorkflowCreated(newWorkflow.id);
          }
        } else {
          setCurrentWorkflowId(workflowId);
          
          console.log("[AI Prompt] Updating existing workflow:", workflowId);
          console.log("[AI Prompt] Has existingWorkflow context:", !!existingWorkflow);
          
          // If we sent existing workflow data, AI returns a complete replacement
          // Otherwise, append new nodes to empty workflow
          if (existingWorkflow) {
            console.log("[AI Prompt] REPLACING workflow with AI response");
            console.log(
              "[AI Prompt] Replacing",
              realNodes.length,
              "nodes with",
              workflowData.nodes?.length || 0,
              "nodes"
            );
            
            // Replace workflow entirely with AI's modified version
            setNodes(workflowData.nodes || []);
            setEdges(validEdges);
            if (workflowData.name) {
              setCurrentWorkflowName(workflowData.name);
            }
            
            toast.success("Modified workflow");
          } else {
            console.log("[AI Prompt] Setting workflow for empty canvas");
            
            // For empty workflows, just set the new data
            setNodes(workflowData.nodes || []);
            setEdges(validEdges);
            setCurrentWorkflowName(workflowData.name || "AI Generated Workflow");
            
            toast.success("Generated workflow");
          }

          const selectedNode = workflowData.nodes?.find(
            (n: { selected?: boolean }) => n.selected
          );
          if (selectedNode) {
            setSelectedNodeId(selectedNode.id);
          }

          // Save the updated workflow
          await api.workflow.update(workflowId, {
            name: workflowData.name,
            description: workflowData.description,
            nodes: workflowData.nodes,
            edges: validEdges,
          });
        }

        // Clear and close
        setPrompt("");
        setIsExpanded(false);
        inputRef.current?.blur();
      } catch (error) {
        console.error("Failed to generate workflow:", error);
        toast.error("Failed to generate workflow");
      } finally {
        setIsGenerating(false);
      }
    },
    [
      prompt,
      isGenerating,
      workflowId,
      hasNodes,
      nodes,
      edges,
      setIsGenerating,
      setCurrentWorkflowId,
      setNodes,
      setEdges,
      setCurrentWorkflowName,
      setSelectedNodeId,
      onWorkflowCreated,
    ]
  );

  return (
    <>
      {/* Always visible prompt input */}
      <div 
        ref={containerRef}
        className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 px-4"
        style={{
          width: isExpanded ? "min(100%, 42rem)" : "20rem",
          transition: "width 150ms ease-out",
        }}
      >
        <form
          className="relative flex items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg"
          onSubmit={handleGenerate}
        >
          {isGenerating && prompt ? (
            <Shimmer className="flex-1 text-sm whitespace-pre-wrap" duration={2}>
              {prompt}
            </Shimmer>
          ) : (
            <textarea
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground resize-none min-h-[24px] max-h-[200px] py-0"
              disabled={isGenerating}
              onBlur={handleBlur}
              onChange={(e) => {
                setPrompt(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onFocus={handleFocus}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate(e as any);
                }
              }}
              placeholder={isFocused ? "Describe your workflow with natural language..." : "Ask AI... (⌘+K)"}
              ref={inputRef}
              rows={1}
              value={prompt}
            />
          )}
          <Button
            className={`${!prompt.trim() || isGenerating ? "invisible" : ""} shrink-0`}
            disabled={!prompt.trim() || isGenerating}
            size="sm"
            type="submit"
          >
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </div>
    </>
  );
}

