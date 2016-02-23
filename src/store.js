import { createStore } from 'redux';

import Parser from './parser';
import Placeholder from './ast/placeholder';
import { add, sub, mul, div } from './operations';
import { traverseNode, deepEqual, findNode } from './ast/node-utils';
import params from './params';
import Selection from './ui/selection';

const parser = new Parser();

const initialState = {
    steps: [{
        math: params.start ? parser.parse(params.start) : parser.parse('2x+5=10'),
    }],
    currentIndex: 0,
    activeIndex: 0,
    goal: params.end ? parser.parse(params.end) : parser.parse('x=5/2')
};

const reducer = (state = initialState, action) => {
    const currentStep = state.steps[state.currentIndex];
    const newMath = currentStep.userInput ? currentStep.userInput.math.clone() : currentStep.math.clone();
    const lastStep = state.steps[state.steps.length - 1];
    const previousSteps = state.steps.slice(0, state.currentIndex);
    let maxId = 0;

    switch (action.type) {
        case 'SELECT_STEP':
            if (action.step === -1) {
                return {
                    ...state,
                    steps: [
                        ...state.steps.map(step => {
                            return {
                                ...step,
                                active: false,
                            };
                        }),
                    ],
                    currentStep: {
                        ...currentStep,
                        active: true,
                    },
                };
            }
            return {
                ...state,
                currentStep: {
                    ...currentStep,
                    active: false,
                },
                steps: [
                    ...state.steps.slice(0, action.step).map(step => {
                        return {
                            ...step,
                            active: false,
                        };
                    }),
                    {
                        ...state.steps[action.step],
                        active: true
                    },
                    ...state.steps.slice(action.step + 1).map(step => {
                        return {
                            ...step,
                            active: false,
                        };
                    }),
                ],
            };
        case 'SELECT_MATH':
            return {
                ...state,
                steps: [
                    ...state.steps.slice(0, state.currentIndex),
                    {
                        ...currentStep,
                        selections: action.selections,
                    },
                    ...state.steps.slice(state.currentIndex + 1)
                ],
            };
        case 'SIMPLE_OPERATION':
            // TODO: have two modes... when we're in insertion mode any keystroke get's appended to the current insertionText
            // TODO: we need to keep track of the operation we're using during the insertion mode so we can insert parens appropriately

            // TODO: reduce for tree traversal
            traverseNode(newMath, node => maxId = Math.max(maxId, node.id));

            if (currentStep.cursor) {
                traverseNode(newMath, node => {
                    if (node.type === 'Placeholder') {
                        node.text += action.operator;
                    }
                });

                return {
                    ...state,
                    steps: [
                        ...state.steps.slice(0, state.currentIndex),
                        {
                            ...currentStep,
                            math: newMath,
                            maxId: currentStep.maxId,
                            cursor: true,
                        },
                        ...state.steps.slice(state.currentIndex + 1)
                    ],
                };
            }

            if (currentStep.math.root.type === 'Equation') {
                const op = {
                    '+': add,
                    '-': sub,
                    '*': mul,
                    '/': div
                }[action.operator];
                const placeholder = new Placeholder();
                newMath.root = op(newMath.root, placeholder);
            }

            return {
                ...state,
                currentIndex: state.currentIndex + 1,
                activeIndex: state.activeIndex + 1,
                steps: [
                    ...state.steps.slice(0, state.currentIndex + 1),
                    {
                        math: newMath,
                        maxId: maxId,
                        action: {
                            type: 'INSERT',
                            operation: action.operator,
                            value: null
                        },
                    },
                ],
            };
        case 'SHOW_CURSOR':
            return {
                ...state,
                steps: [
                    ...state.steps.slice(0, state.currentIndex),
                    {
                        ...currentStep,
                        cursor: true,
                    },
                    ...state.steps.slice(state.currentIndex + 1)
                ]
            };
        case 'INSERT_NUMBER':
            traverseNode(newMath, node => {
                if (node.type === 'Placeholder') {
                    node.text += action.number;
                }
            });

            if (currentStep.userInput) {
                return {
                    ...state,
                    steps: [
                        ...state.steps.slice(0, state.currentIndex),
                        {
                            ...currentStep,
                            userInput: {
                                ...currentStep.userInput,
                                math: newMath,
                            },
                        },
                        ...state.steps.slice(state.currentIndex + 1)
                    ],
                };
            } else {
                return {
                    ...state,
                    steps: [
                        ...state.steps.slice(0, state.currentIndex),
                        {
                            ...currentStep,
                            math: newMath,
                        },
                        ...state.steps.slice(state.currentIndex + 1)
                    ],
                };
            }
        case 'BACKSPACE':
            traverseNode(newMath, node => {
                if (node.type === 'Placeholder') {
                    if (node.text === '') {
                        // TODO: think about how to undo the operation
                    } else {
                        node.text = node.text.slice(0, node.text.length - 1);
                    }
                }
            });

            if (currentStep.userInput) {
                return {
                    ...state,
                    steps: [
                        ...state.steps.slice(0, state.currentIndex),
                        {
                            ...currentStep,
                            userInput: {
                                ...currentStep.userInput,
                                math: newMath,
                            },
                        },
                        ...state.steps.slice(state.currentIndex + 1)
                    ],
                };
            } else {
                return {
                    ...state,
                    steps: [
                        ...state.steps.slice(0, state.currentIndex),
                        {
                            ...currentStep,
                            math: newMath,
                        },
                        ...state.steps.slice(state.currentIndex + 1)
                    ],
                };
            }
        case 'ACCEPT_STEP':
            let value = null;
            traverseNode(newMath, node => {
                if (node.type === 'Placeholder') {
                    // TODO: try/catch and provide feedback if math isn't valid
                    value = parser.parse(node.text).root;
                    node.parent.replace(node, value);
                }
            });

            if (currentStep.userInput) {
                const selections = currentStep.selections;
                const {transform} = currentStep.userInput;

                const newNewMath = currentStep.math.clone();

                const newSelections = selections.map(selection => {
                    const first = findNode(newNewMath, selection.first.id);
                    const last = findNode(newNewMath, selection.last.id);
                    return new Selection(first, last);
                });

                if (transform.canTransform(newSelections)) {
                    transform.doTransform(newSelections, newMath.root.right.clone());
                }

                return {
                    ...state,
                    steps: [
                        ...previousSteps,
                        {
                            selections: [],
                            math: currentStep.math.clone(),
                            action: {
                                type: 'TRANSFORM',
                                transform: transform,
                                selections: selections,
                            },
                        },
                        {
                            math: newNewMath,
                            selections: [],
                            active: true,
                        },
                    ],
                    activeIndex: state.activeIndex + 1,
                    currentIndex: state.currentIndex + 1,
                };
            } else {
                return {
                    ...state,
                    steps: [
                        ...previousSteps,
                        {
                            math: newMath,
                            cursor: false,
                            action: {
                                ...lastStep.action,
                                value: value.clone(),
                                maxId: Infinity,
                            },
                        },
                    ]
                };
            }
        case 'ADD_STEP':
            return {
                ...state,
                steps: [
                    ...previousSteps,
                    {
                        math: currentStep.math.clone(),
                        action: {
                            type: 'TRANSFORM',
                            transform: action.transform,
                            selections: currentStep.selections,
                        },
                    },
                    {
                        math: action.math,
                    },
                ],
                activeIndex: state.activeIndex + 1,
                currentIndex: state.currentIndex + 1,
            };
        case 'CHECK_ANSWER':
            const finished = deepEqual(state.goal, currentStep.math);

            return {
                ...state,
                steps: [
                    ...state.steps.slice(0, state.currentIndex),
                    {
                        ...currentStep,
                        finished: finished,
                    },
                    ...state.steps.slice(state.currentIndex + 1)
                ],
            };
        case 'GET_USER_INPUT':
            console.log(action);
            const selection = action.selections[0];
            const math = parser.parse('a=b');
            const left = selection.toExpression();
            const right = new Placeholder();
            math.root.left = left;
            left.parent = math.root;
            math.root.right = right;
            right.parent = math.root;

            return {
                ...state,
                steps: [
                    ...state.steps.slice(0, state.currentIndex),
                    {
                        ...currentStep,
                        userInput: {
                            transform: action.transform,
                            value: '',
                            math: math,
                        },
                    },
                    ...state.steps.slice(state.currentIndex + 1)
                ],
            };
        case 'UNDO':
            return {
                ...state,
                currentIndex: Math.max(0, state.currentIndex - 1),
                activeIndex: Math.max(0, state.currentIndex - 1),
            };
        case 'REDO':
            return {
                ...state,
                currentIndex: Math.min(state.currentIndex + 1, state.steps.length - 1),
                activeIndex: Math.min(state.currentIndex + 1, state.steps.length - 1),
            };
        default:
            return state;
    }
};

const store = createStore(reducer);

export { store as default };
