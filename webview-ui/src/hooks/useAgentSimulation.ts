import { useEffect, useRef } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';

interface SimulationState {
  state: 'idle' | 'working' | 'permission';
  toolId?: string;
  toolName?: string;
  statusText?: string;
  timer: number; // seconds remaining in current state
}

const MOCK_TOOLS = [
  { name: 'run_command', status: 'Running build...' },
  { name: 'view_file', status: 'Viewing index.css...' },
  { name: 'write_to_file', status: 'Writing new React component...' },
  { name: 'grep_search', status: 'Searching source files...' },
  { name: 'run_command', status: 'Running unit tests...' },
  { name: 'web_search', status: 'Researching API documentation...' },
];

export function useAgentSimulation(getOfficeState: () => OfficeState) {
  const simStateRef = useRef<Map<number, SimulationState>>(new Map());

  useEffect(() => {
    const interval = setInterval(() => {
      const os = getOfficeState();
      const simStates = simStateRef.current;

      // Filter characters that are simulated
      const simulatedChars = Array.from(os.characters.values()).filter((ch) => ch.isSimulated);

      // Clean up states for removed agents
      const simulatedCharIds = new Set(simulatedChars.map((ch) => ch.id));
      for (const id of simStates.keys()) {
        if (!simulatedCharIds.has(id)) {
          simStates.delete(id);
        }
      }

      for (const ch of simulatedChars) {
        let state = simStates.get(ch.id);
        if (!state) {
          state = { state: 'idle', timer: Math.floor(Math.random() * 15) + 5 };
          simStates.set(ch.id, state);
        }

        // Decrement timer
        if (state.timer > 0) {
          state.timer--;
        }

        // State Machine logic
        if (state.state === 'idle') {
          // If in idle state, make sure tools are cleared
          if (ch.currentTool) {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: { type: 'agentToolsClear', id: ch.id },
              }),
            );
          }

          if (state.timer <= 0) {
            // Transition to working/active!
            const mockTool = MOCK_TOOLS[Math.floor(Math.random() * MOCK_TOOLS.length)];
            const toolId = `sim-tool-${Math.random().toString(36).substring(2, 9)}`;
            const isPermission = Math.random() < 0.25; // 25% chance of needing permission

            state.state = isPermission ? 'permission' : 'working';
            state.toolId = toolId;
            state.toolName = mockTool.name;
            state.statusText = mockTool.status;
            state.timer = Math.floor(Math.random() * 12) + 8; // 8 to 20 seconds of work

            // Trigger tool start
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'agentToolStart',
                  id: ch.id,
                  toolId,
                  toolName: mockTool.name,
                  status: mockTool.status,
                  permissionActive: isPermission,
                },
              }),
            );

            if (isPermission) {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    type: 'agentToolPermission',
                    id: ch.id,
                    toolId,
                  },
                }),
              );
            }
          }
        } else if (state.state === 'working') {
          if (state.timer <= 0) {
            // Done working! Dispatch tool completion
            window.dispatchEvent(
              new MessageEvent('message', {
                data: { type: 'agentToolDone', id: ch.id, toolId: state.toolId },
              }),
            );

            // Set agent to idle state so they can stand up and wander
            window.dispatchEvent(
              new MessageEvent('message', {
                data: { type: 'agentStatus', id: ch.id, status: 'idle' },
              }),
            );

            state.state = 'idle';
            state.timer = Math.floor(Math.random() * 25) + 15; // 15 to 40 seconds of rest/wandering
            state.toolId = undefined;
            state.toolName = undefined;
            state.statusText = undefined;
          }
        } else if (state.state === 'permission') {
          // If in permission approval state, check if the user clicked/dismissed the permission bubble
          const isBubbleDismissed = ch.bubbleType !== 'permission';

          if (isBubbleDismissed) {
            // User clicked and approved the permission bubble!
            state.state = 'working';
            state.timer = Math.floor(Math.random() * 8) + 5; // work for another 5-13 seconds

            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'agentToolPermissionClear',
                  id: ch.id,
                  toolId: state.toolId,
                },
              }),
            );
          } else {
            // Auto-approve after 30 seconds if user ignores it
            if (state.timer <= 0) {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    type: 'agentToolPermissionClear',
                    id: ch.id,
                    toolId: state.toolId,
                  },
                }),
              );
              state.state = 'working';
              state.timer = Math.floor(Math.random() * 8) + 5;
            }
          }
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [getOfficeState]);
}
